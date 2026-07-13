# Wyrdwood — hardware

Wyrdwood renders with WebGL2 through Chromium (the browser in development, the
same engine bundled in the Electron app), so the graphics scale the same way on
both. Pick a preset in **Settings → Graphics**, or tune the individual sliders.

> **These numbers are an estimate, not a benchmark.** They will be replaced with
> measured figures. Press **F3** in game to see your own frame rate.

## Minimum

Playable on **Low** at 1280×720 — no shadows, no grass, no post-processing,
short view distance.

| | |
|---|---|
| OS | macOS 12 / Windows 10 64-bit |
| CPU | Dual-core Intel Core i5 (2017+) or Apple M1 |
| GPU | Any WebGL2 GPU with 1 GB VRAM (Intel Iris Plus, AMD Vega 8) |
| Memory | 8 GB RAM |
| Storage | 500 MB |

## Recommended

60 fps on **High** at 1920×1080 — the intended experience: shadows, the full
grass carpet, bloom and colour grading, 5-chunk view distance.

| | |
|---|---|
| OS | macOS 13+ / Windows 11 |
| CPU | Apple M1 Pro / Intel Core i5-11400 / Ryzen 5 5600 |
| GPU | Apple M-series integrated, NVIDIA GTX 1660, or AMD RX 5600 (4 GB VRAM) |
| Memory | 16 GB RAM |
| Storage | 1 GB |

## If it runs slowly

In order of impact:

1. **Vegetation density / range.** The grass carpet is the single heaviest thing
   in the scene — planted densely enough to close into real grassland, it runs
   ~190k triangles per 64 m chunk. Turning it down (or off) is usually worth
   20–30 fps on integrated graphics. The ground's own texture is a photograph of
   grass, so the world still looks right without it.
2. **Render distance.**
3. **Shadows.**

Every one of these is an individual slider, so you don't have to drop a whole
preset to fix one bottleneck.
