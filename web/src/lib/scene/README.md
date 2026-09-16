# scene: Wallpaper Engine scenes in this app

The code that reads and renders a Wallpaper Engine `scene.pkg` lives in a **git
submodule**: [wallpaper-scene-layers](https://github.com/Moistrocic/wallpaper-scene-layers)
(MIT). It is not on npm, so the workspace depends on the directory itself:

```
web/src/lib/wallpaper-scene-layers/            <- the submodule
  packages/we-scene/src/                       <- the library's source
  packages/we-scene/dist/                      <- built, and not committed
```

The parent records the exact commit, so which version is in use is a property of
the repository rather than something you have to infer from a copied file tree:

```bash
git submodule status                                              # what is checked out
git ls-tree HEAD web/src/lib/wallpaper-scene-layers               # what the repo pins
git -C web/src/lib/wallpaper-scene-layers log --oneline -1        # which upstream commit
```

A clone needs `--recursive`, or one extra command afterwards:

```bash
git clone --recursive <this repo>
# or, in an existing clone
git submodule update --init --recursive
```

`scripts/install.sh` does that for you. The library's package entry is built
rather than committed, so `npm run build:scene` (and `npm install`, through
`prepare`) compiles it with the TypeScript at the root; `web/vite.config.ts`
refuses to build while it is missing, so the failure is one clear sentence
rather than a wall of unresolved imports.

## What this directory adds

Nothing from the submodule is modified. What is here is the app's side of the
bargain - a smaller surface than the library's:

| File | What it does |
| --- | --- |
| `play-scene.ts` | the live path: loads the container in a **worker**, starts it, and hands back start/stop/pause. Also the one place that asks whether this browser can run a scene at all (once, remembered), caps the drawing buffer, and aborts a load nobody is waiting for |
| `render-still.ts` | the still path: one composited frame, cached in IndexedDB under the wallpaper's identity, plus the WebGL context that is handed back when the renderer is done |

## Why there is so little of it

The library does the work - parsing `PKGV`, decoding `.tex`, compiling the
package's GLSL, the particle simulation, the render loop - and it grew a worker
mode, so this app no longer keeps a second implementation of any of it. What is
left here is the part that is about *this* app: when a scene plays, how big its
buffer may get, what is remembered between visits, and what to say when a
browser cannot do it.

## Version

Pinned at upstream `fafde5d` (the commit that moved rendering into a worker). To
move it:

```bash
git -C web/src/lib/wallpaper-scene-layers fetch origin
git -C web/src/lib/wallpaper-scene-layers checkout <commit>
npm run build:scene
git add web/src/lib/wallpaper-scene-layers && git commit -m "chore: bump wallpaper-scene-layers to <commit>"
```