import { Game } from './game';
import { MainMenu, WorldSetup, PauseMenu, WinScreen } from './ui/menus';
import { CharacterCreator } from './ui/creator';
import { SettingsScreen } from './ui/settingsScreen';
import { LoadingScreen } from './ui/loading';
import { DEFAULT_APPEARANCE } from './data/appearance';
import { hasSave, loadSave } from './save/save';
import type { WorldOptions } from './game';

/**
 * Bootstrap + menu flow: menu → character creator → world setup → playing.
 * `?dev` skips menus for scripted playtests. Quit-to-menu reloads the page
 * (clean slate for a fresh world).
 */
async function main(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('#app container missing');

  const dev = new URLSearchParams(location.search).has('dev');
  const game = await Game.create(container);

  const pause = new PauseMenu();
  const win = new WinScreen();
  const settingsScreen = new SettingsScreen();
  const loading = new LoadingScreen();
  pause.onSettings = () => settingsScreen.show();

  // Show the loading screen while the spawn area streams in, then start playing.
  game.onLoadProgress = (p) => loading.setProgress(p);
  game.onReady = () => loading.hide();
  const startWorld = (opts: WorldOptions): void => {
    loading.show();
    game.start(opts);
  };

  game.onPauseToggle = () => {
    game.paused = !game.paused;
    pause.setVisible(game.paused);
    if (game.paused) game.saveNow();
  };
  pause.onResume = () => {
    game.paused = false;
    pause.setVisible(false);
  };
  pause.onQuit = () => {
    game.saveNow();
    location.reload();
  };
  game.onWin = () => win.show();
  win.onContinue = () => {
    /* sandbox continues; world stays live */
  };

  if (dev) {
    // ?dev&continue resumes the save (harness tests the Continue path this way).
    const save = new URLSearchParams(location.search).has('continue') ? loadSave() : null;
    if (save) startWorld({ seedText: save.seedText, appearance: save.appearance, save });
    else startWorld({ seedText: 'wyrdwood', appearance: DEFAULT_APPEARANCE });
    return;
  }

  const menu = new MainMenu(hasSave());
  const creator = new CharacterCreator();
  const setup = new WorldSetup();

  menu.onNewGame = () => creator.show();
  menu.onSettings = () => settingsScreen.show();
  menu.onContinue = () => {
    const save = loadSave();
    if (save) {
      startWorld({ seedText: save.seedText, appearance: save.appearance, save });
    } else {
      creator.show(); // corrupt/missing save — fall back to new game
    }
  };
  creator.onDone = () => setup.show();
  creator.onBack = () => menu.show();
  setup.onStart = () => {
    startWorld({ seedText: setup.seedText, appearance: creator.appearance });
  };
  setup.onBack = () => creator.show();
  menu.show();
}

// Surface any runtime error on screen (dev builds) so failures are never silent.
window.addEventListener('error', (e) => {
  if (document.getElementById('fatal-error')) return;
  const pre = document.createElement('pre');
  pre.id = 'fatal-error';
  pre.style.cssText =
    'position:fixed;bottom:0;left:0;right:0;max-height:40%;overflow:auto;color:#f88;background:rgba(0,0,0,0.85);padding:1rem;z-index:999;margin:0';
  pre.textContent = `${e.message}\n${e.error?.stack ?? ''}`;
  document.body.appendChild(pre);
});

main().catch((err) => {
  console.error('Wyrdwood failed to start:', err);
  document.body.innerHTML = `<pre style="color:#f88;padding:2rem">${String(err)}</pre>`;
});
