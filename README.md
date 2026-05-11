# Floripa Surfer

A low-poly browser surf game built with Vite, TypeScript, and Three.js.

Floripa Surfer is an arcade surf prototype focused on water feel: moving swell sets to chase, board-water deformation, tail-heavy board contouring, geodesic foam, wake bubbles, and a local-only pose editor for tuning the rider.

## Features

- Moving wave-set strips that travel through the world and affect physics, foam, and rendering.
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
