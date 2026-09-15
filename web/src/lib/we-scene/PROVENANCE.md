# we-scene (vendored)

Wallpaper Engine `scene.pkg` parser and renderer, taken from
<https://github.com/wangkaxds/we-scene> — MIT, see `LICENSE` beside this file.
Copyright the we-scene authors. Vendored verbatim; do not edit these files, so
that a future update is a straight copy.

It is what makes scene wallpapers usable here: a `scene.pkg` is a container of
layer textures (TEX: DXT1/3/5, ARGB8888, RGB565, L8, LZ4, embedded PNG/JPEG)
plus `scene.json` describing their hierarchy, transforms and effect chains.
The wallpaper's own `preview.jpg` is a square workshop thumbnail, not the
picture, so the only way to get the real background is to compose the layers.

## What was kept

| File | Why |
| --- | --- |
| `pkg/container.js` | PKGV container parsing |
| `pkg/texture.js` | TEX decoding, LZ4, pixel formats |
| `scene/parse.js` | scene.json → layers, hierarchy, transforms |
| `scene/effects-parse.js` | effect material chains |
| `render/cpu.js` | software rasteriser: composes one frame, no GPU needed |
| `render/math.js`, `render/noise.js`, `render/effects.js` | maths, noise, effect formulas |
| `render/renderer.js`, `render/hlsl2glsl.js` | WebGL renderer for the live scene |

## What was left out

| File | Why |
| --- | --- |
| `pkg/png.js` | `node:zlib` + Buffer |
| `pkg/png-write.js` | `node:zlib` + Buffer; the browser exports through OffscreenCanvas instead |
| `scene/load.js` | decodes embedded images synchronously through Node; replaced by `../scene/load-browser.ts` |
| `bundle.js` | Node convenience wrapper |

The browser loader does more than the original Node one, not less: it decodes
embedded JPEG and PNG textures directly with `createImageBitmap`, where the
Node path needed them pre-converted to PNG on disk.
