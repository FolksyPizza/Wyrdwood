#!/usr/bin/env node
/**
 * Dev playtest harness: drives the game in headless Chrome via Puppeteer.
 *
 * Usage:
 *   node scripts/playtest.mjs [--shot out.png] [--wait ms] [--keys "KeyW:2000,Space:200"]
 *
 * Prints all console messages / page errors, optionally holds keys, then
 * screenshots. Used to verify each milestone actually runs.
 */
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const get = (flag, def) => {
  const i = args.indexOf(flag);
  return i === -1 ? def : args[i + 1];
};

const URL = get('--url', 'http://localhost:5173/');
const SHOT = get('--shot', null);
const WAIT = Number(get('--wait', '8000'));
const KEYS = get('--keys', '');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1280,800'],
  defaultViewport: { width: 1280, height: 800 },
});

const page = await browser.newPage();
page.on('console', (msg) => console.log(`[console.${msg.type()}]`, msg.text()));
page.on('pageerror', (err) => console.log('[pageerror]', err.message));

await page.goto(URL, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, WAIT));

// Optional JS to evaluate BEFORE the key/mouse sequence (setup, e.g. select a blueprint).
const PRE = get('--pre-eval', null);
if (PRE) {
  const result = await page.evaluate(PRE);
  console.log('[pre-eval]', JSON.stringify(result));
}

// Optional: click canvas first (acquires pointer lock), then drive inputs.
// --keys accepts key holds ("KeyW:2000") and mouse moves ("mouse:dx:dy").
const CLICK = args.includes('--click');
if (CLICK) {
  await page.mouse.click(640, 400);
  await new Promise((r) => setTimeout(r, 500));
}
if (KEYS) {
  for (const part of KEYS.split(',')) {
    const bits = part.split(':');
    if (bits[0] === 'js') {
      // URI-encoded JS snippet (commas-safe), e.g. js:document.querySelector(...).click()
      await page.evaluate(decodeURIComponent(bits.slice(1).join(':')));
      await new Promise((r) => setTimeout(r, 400));
    } else if (bits[0] === 'wait') {
      await new Promise((r) => setTimeout(r, Number(bits[1] ?? 1000)));
    } else if (bits[0] === 'click') {
      await page.mouse.click(Number(bits[1]), Number(bits[2]));
      await new Promise((r) => setTimeout(r, 400));
    } else if (bits[0] === 'rclick') {
      await page.mouse.click(640, 400, { button: 'right' });
      await new Promise((r) => setTimeout(r, 400));
    } else if (bits[0] === 'mouse') {
      // Relative mouse move (pointer-lock movementX/Y), in small steps.
      const dx = Number(bits[1]);
      const dy = Number(bits[2] ?? 0);
      const steps = 10;
      for (let i = 0; i < steps; i++) {
        await page.mouse.move(640 + (dx / steps) * (i + 1), 400 + (dy / steps) * (i + 1));
      }
      await new Promise((r) => setTimeout(r, 300));
    } else {
      await page.keyboard.down(bits[0]);
      await new Promise((r) => setTimeout(r, Number(bits[1] ?? 100)));
      await page.keyboard.up(bits[0]);
    }
  }
  await new Promise((r) => setTimeout(r, 1000));
}

// Optional JS to evaluate in the page (e.g. inspect window.__game).
const EVAL = get('--eval', null);
if (EVAL) {
  const result = await page.evaluate(EVAL);
  console.log('[eval]', JSON.stringify(result));
}

// Report game state if the page exposes it.
const title = await page.title();
console.log('[title]', title);

if (SHOT) {
  await page.screenshot({ path: SHOT });
  console.log('[shot]', SHOT);
}
await browser.close();
