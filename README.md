# Floripa Surfer

A low-poly browser surf game built with Vite, TypeScript, and Three.js.

Floripa Surfer is an arcade surf prototype focused on water feel: breaking wave sets with peeling barrels you can ride inside, board-water deformation, tail-heavy board contouring, geodesic foam, wake bubbles, and a local-only pose editor for tuning the rider.

## Features

- Breaking wave sets that travel shoreward with a peeling pocket: green shoulder ahead of the peel, a curling lip and open barrel at the pocket, collapse and rolling whitewater behind it.
- Rideable barrels: drop in, tuck under the folded lip, and race the peel down the line. A HUD timer tracks tube time, the camera pulls in low for the view through the tube, and making it out fires spit and a score flash.
- Wave-aware physics: gravity slides the board down the face, the pocket carries it down the line, whitewater drags, shoves, and cuts steering authority.
- Curling lip geometry: the ocean sheet folds forward over the face, with tube-interior shading, a backlit thin-lip glow, and lip-edge foam.
- A pocket arrow that points at the next makeable barrel section.
- Sim-driven rider animation: barrel tuck, speed crouch, whitewater brace, jump and air poses, landing-impact reactions, and a procedural secondary-motion layer, all authored through the pose-editor library.
- Board contouring from nose, tail, rail, and center water probes.
- Main-ocean deformation plus fading tail wake stamps, so water returns to the procedural wave over time.
- Low-poly ocean, horizon terrain, foam fields, spray, and contact bubbles.
- Keyboard and touch controls.
- Local-only pose editor for authoring rider poses.

## Requirements

- Node.js 20 or newer.
- npm.

## Getting Started

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. The dev script binds to `127.0.0.1` so the pose editor is available only on a loopback host.

## Controls

- `W` / `S`: pump forward or slow down.
- `A` / `D`: carve left or right.
- `Space`: jump.
- Arrow keys: trick direction inputs.
- Touch: drag on the canvas to steer/pump, tap for the jump action.

### Getting barreled

Follow the pocket arrow to the peeling section, point at the beach to drop in over the crest, then angle left down the line and tuck under the lip. Stay ahead of the collapse — too slow and the whitewater swallows you, too fast and you race out onto the shoulder. The waves peel left, so hold a line slightly into the face to sit deeper in the tube.

## Local Pose Editor

The pose editor is intentionally local-only.

- The `Pose Editor` button appears on `localhost`, `127.x.x.x`, and `::1`.
- Direct `?view=pose-editor` access falls back to the game on deployed or network hosts.
- Pose file saves go through the Vite dev-server middleware in [vite.config.ts](./vite.config.ts), so public static deployments do not expose the save endpoint.

## Scripts

```bash
npm run dev      # local development server
npm test         # Vitest suite
npm run build   # type-check and production build
npm run preview # preview the production build locally
npm run check   # tests, then build
```

## Deployment

This is a static Vite app. Build output lands in `dist/`:

```bash
npm run build
```

The current build is small enough for Hataw quick publish, but any static host can serve the `dist/` folder.

Releases are also published to the `gh-pages` branch as a relative-base build (`vite build --base=./`), so the game can be served from a subpath. To host it on GitHub Pages, enable Pages for the `gh-pages` branch in the repository settings; runtime asset URLs are base-aware, so models load correctly under either a root or subpath deployment.

## Project Layout

- [src/game](./src/game): input and simulation.
- [src/render](./src/render): Three.js ocean, world, surfer model, pose editor, and water contact helpers.
- [src/ui](./src/ui): HUD and touch controls.
- [src/data/defaultPoseLibrary.json](./src/data/defaultPoseLibrary.json): bundled rider pose states.
- [public/assets/models/ATTRIBUTION.md](./public/assets/models/ATTRIBUTION.md): third-party model credits.

## Assets

Model attribution is tracked in [public/assets/models/ATTRIBUTION.md](./public/assets/models/ATTRIBUTION.md). Some assets are Creative Commons Attribution 3.0 and require credit in public uses.

## License

No project license has been selected yet. Until one is added, treat the source as all rights reserved by default. Third-party model assets retain their original licenses.
