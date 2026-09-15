# scene: Wallpaper Engine scenes in this app

The code that reads and renders a Wallpaper Engine `scene.pkg` lives in a **git
submodule**: [we-scene](https://github.com/wangkaxds/we-scene), MIT.

```
web/src/lib/we-scene/   <- submodule, pinned by the parent repository
```

The parent records the exact commit, so which version is in use is a property of
the repository rather than something you have to infer from a copied file tree:

```bash
git submodule status                                     # what is checked out
git ls-tree HEAD web/src/lib/we-scene                    # what the repo pins
git -C web/src/lib/we-scene log --oneline -1             # which upstream commit
```

A clone needs `--recursive`, or one extra command afterwards:

```bash
git clone --recursive <this repo>
# or, in an existing clone
git submodule update --init --recursive
```

`scripts/install.sh` does that for you, and fails the copy check if the
directory is still empty. `web/vite.config.ts` refuses to build without it, so
the failure is one clear sentence rather than a wall of unresolved imports.

## What this directory adds

Nothing from the submodule is modified. Everything here is our own:

| File | What it does |
| --- | --- |
| `we-types.ts` | structural types for the parts of we-scene we touch, since its JavaScript carries none |
| `load-browser.ts` | the scene asset loader, ported from we-scene's `scene/load.js` |
| `scene.worker.ts` | composes a still on the CPU, or runs the scene live through WebGL |
| `worker.ts`, `protocol.ts` | the message plumbing between the page and that worker |
| `render-still.ts` | the still path, with an IndexedDB cache |
| `play-scene.ts` | the live path, driven from an OffscreenCanvas |

## Why the loader was ported rather than reused

we-scene's own `scene/load.js` decodes embedded PNG and JPEG through Node's
`zlib` and `Buffer`, and expects JPEG textures to have been pre-converted into
PNG files on disk by a separate tool. A browser has `createImageBitmap`, so
`load-browser.ts` is async, needs no side files, and resolves **more** textures
than the Node path does: six layers against five on the scene used to develop it.

Two behaviours were added on top of the original:

- a layer whose material is missing is **hidden** rather than painted with the
  rasteriser's 1x1 white fallback, which otherwise shows up as white rectangles
  over the picture;
- Wallpaper Engine's own component layers - the clock, the audio info card,
  album art, buttons - are hidden too. They are solid-colour widgets with no
  size and no texture in the container, and we-scene lists components as
  unsupported, so they can only ever be white boxes here.

## Version

Pinned at upstream `6b503a3`. To move it:

```bash
git -C web/src/lib/we-scene fetch origin
git -C web/src/lib/we-scene checkout <commit>
git add web/src/lib/we-scene && git commit -m "chore: bump we-scene to <commit>"
```
