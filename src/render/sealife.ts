/**
 * Ambient sea life — a lone turtle drifting near the surface and an
 * occasional dolphin pod arcing out of the water.
 *
 * Models load lazily via GLTFLoader; the rest of the game keeps running if
 * either asset fails. The behaviour is purely cosmetic — sea life never
 * touches the surfer simulation.
 */

import {
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { SurferState } from '../game/simulation/surfer';
import { sampleWave } from '../game/simulation/waves';

const TURTLE_URL = '/assets/models/sea-turtle-google.glb';
const DOLPHIN_URL = '/assets/models/dolphin-quaternius.glb';

const TURTLE_SCALE = 0.003;
const DOLPHIN_SCALE = 0.4;

const TURTLE_DRIFT_SPEED = 1.4; // units per second
const TURTLE_RESPAWN_DISTANCE = 110;
const TURTLE_SPAWN_RING_MIN = 38;
const TURTLE_SPAWN_RING_MAX = 70;
const TURTLE_DIVE_PERIOD_MIN = 22;
const TURTLE_DIVE_PERIOD_MAX = 42;

const DOLPHIN_POD_SIZE = 3;
const DOLPHIN_COOLDOWN_MIN = 32;
const DOLPHIN_COOLDOWN_MAX = 58;
const DOLPHIN_SPAWN_RING_MIN = 26;
const DOLPHIN_SPAWN_RING_MAX = 56;
const DOLPHIN_JUMP_DURATION = 1.55;
const DOLPHIN_JUMP_PEAK = 2.4;

export type SeaLife = {
  root: Group;
  update: (state: SurferState, time: number, dt: number) => void;
};

export function createSeaLife(): SeaLife {
  const root = new Group();
  const loader = new GLTFLoader();

  // ----- Turtle -----------------------------------------------------------
  const turtleHolder = new Group();
  const turtleInner = new Group();
  turtleHolder.add(turtleInner);
  root.add(turtleHolder);

  type TurtleState = {
    ready: boolean;
    pos: Vector3;
    heading: number;
    headingTarget: number;
    headingTimer: number;
    diveCountdown: number;
    diveTimer: number; // 0 = surface; >0 ramps down then up
  };

  const turtle: TurtleState = {
    ready: false,
    pos: new Vector3(20, 0, 20),
    heading: 0,
    headingTarget: 0,
    headingTimer: 4,
    diveCountdown: randRange(TURTLE_DIVE_PERIOD_MIN, TURTLE_DIVE_PERIOD_MAX),
    diveTimer: 0,
  };

  loader.loadAsync(TURTLE_URL).then(
    (gltf) => {
      const model = prepareModel(gltf.scene);
      model.scale.setScalar(TURTLE_SCALE);
      // Most polygonal-mind characters face +Z; rotate so heading=0 means it
      // swims along -Z (same convention as the surfer).
      model.rotation.y = Math.PI;
      turtleInner.add(model);
      turtle.ready = true;
    },
    (err) => {
      console.warn('[sealife] turtle load failed', err);
    },
  );

  // ----- Dolphin pod ------------------------------------------------------
  type Dolphin = {
    holder: Group;
    inner: Group;
    lateralOffset: number;
    timeOffset: number;
  };

  const dolphins: Dolphin[] = [];
  for (let i = 0; i < DOLPHIN_POD_SIZE; i += 1) {
    const holder = new Group();
    const inner = new Group();
    holder.add(inner);
    holder.visible = false;
    root.add(holder);
    dolphins.push({
      holder,
      inner,
      lateralOffset: (i - (DOLPHIN_POD_SIZE - 1) / 2) * 2.6,
      timeOffset: i * 0.16,
    });
  }

  type PodState = {
    ready: boolean;
    cooldown: number;
    active: boolean;
    elapsed: number;
    origin: Vector3;
    heading: number;
    distance: number;
  };

  const pod: PodState = {
    ready: false,
    cooldown: randRange(8, 14), // first jump shows up within a few seconds
    active: false,
    elapsed: 0,
    origin: new Vector3(),
    heading: 0,
    distance: 22,
  };

  loader.loadAsync(DOLPHIN_URL).then(
    (gltf) => {
      for (const d of dolphins) {
        // SkeletonUtils.clone() properly clones SkinnedMesh + Bones together.
        // The dolphin is a skinned model — a plain Object3D.clone(true) would
        // duplicate the meshes but leave them pointing at the original skeleton.
        const model = prepareModel(cloneSkinned(gltf.scene));
        model.scale.setScalar(DOLPHIN_SCALE);
        model.rotation.y = Math.PI;
        d.inner.add(model);
      }
      pod.ready = true;
    },
    (err) => {
      console.warn('[sealife] dolphin load failed', err);
    },
  );

  // ----- Update loop ------------------------------------------------------

  function update(state: SurferState, time: number, dt: number): void {
    updateTurtle(state, time, dt);
    updatePod(state, time, dt);
  }

  function updateTurtle(state: SurferState, time: number, dt: number): void {
    if (!turtle.ready) {
      return;
    }

    // Heading wandering — every few seconds pick a new target heading
    turtle.headingTimer -= dt;
    if (turtle.headingTimer <= 0) {
      turtle.headingTarget = turtle.heading + (Math.random() - 0.5) * 1.6;
      turtle.headingTimer = 5 + Math.random() * 5;
    }
    const headingDelta = turtle.headingTarget - turtle.heading;
    turtle.heading += headingDelta * Math.min(1, dt * 0.6);

    // Forward motion in the turtle's heading
    turtle.pos.x += Math.sin(turtle.heading) * TURTLE_DRIFT_SPEED * dt;
    turtle.pos.z -= Math.cos(turtle.heading) * TURTLE_DRIFT_SPEED * dt;

    // Drift away from player? Respawn at the edge of view.
    const dx = turtle.pos.x - state.position.x;
    const dz = turtle.pos.z - state.position.z;
    if (Math.hypot(dx, dz) > TURTLE_RESPAWN_DISTANCE) {
      respawnTurtleNear(state);
    }

    // Dive cycle
    turtle.diveCountdown -= dt;
    if (turtle.diveCountdown <= 0 && turtle.diveTimer <= 0) {
      turtle.diveTimer = 5.5;
      turtle.diveCountdown = randRange(TURTLE_DIVE_PERIOD_MIN, TURTLE_DIVE_PERIOD_MAX);
    }
    let diveDepth = 0;
    if (turtle.diveTimer > 0) {
      // diveTimer counts down from 5.5 to 0. Map to a 0..1..0 envelope.
      const t = 1 - turtle.diveTimer / 5.5;
      const env = Math.sin(Math.PI * t);
      diveDepth = env * 1.8;
      turtle.diveTimer = Math.max(0, turtle.diveTimer - dt);
    }

    const wave = sampleWave(turtle.pos.x, turtle.pos.z, time);
    const y = wave.height - 0.18 - diveDepth;

    turtleHolder.position.set(turtle.pos.x, y, turtle.pos.z);
    turtleHolder.rotation.y = turtle.heading;

    // Gentle pitch with the wave slope, plus a tiny paddle bob
    const bob = Math.sin(time * 1.8) * 0.04;
    turtleInner.rotation.x = wave.slopeZ * 0.4 + bob;
    turtleInner.rotation.z = -wave.slopeX * 0.3;
  }

  function respawnTurtleNear(state: SurferState): void {
    const angle = Math.random() * Math.PI * 2;
    const distance = randRange(TURTLE_SPAWN_RING_MIN, TURTLE_SPAWN_RING_MAX);
    turtle.pos.set(
      state.position.x + Math.sin(angle) * distance,
      0,
      state.position.z - Math.cos(angle) * distance,
    );
    turtle.heading = Math.atan2(state.position.x - turtle.pos.x, state.position.z - turtle.pos.z);
    turtle.headingTarget = turtle.heading;
    turtle.headingTimer = 4;
    turtle.diveTimer = 0;
    turtle.diveCountdown = randRange(TURTLE_DIVE_PERIOD_MIN, TURTLE_DIVE_PERIOD_MAX);
  }

  function updatePod(state: SurferState, time: number, dt: number): void {
    if (!pod.ready) {
      return;
    }

    if (!pod.active) {
      pod.cooldown -= dt;
      if (pod.cooldown <= 0) {
        triggerPodJump(state);
      } else {
        for (const d of dolphins) {
          d.holder.visible = false;
        }
        return;
      }
    }

    pod.elapsed += dt;
    const maxLocal = DOLPHIN_JUMP_DURATION + 0.4; // include time-offset tails

    let anyVisible = false;
    for (const d of dolphins) {
      const local = pod.elapsed - d.timeOffset;
      if (local < 0 || local > DOLPHIN_JUMP_DURATION) {
        d.holder.visible = false;
        continue;
      }
      anyVisible = true;

      // Parabolic arc in 0..1 → height envelope
      const t = local / DOLPHIN_JUMP_DURATION;
      const heightEnv = 4 * t * (1 - t); // 0 → 1 → 0
      const yOff = heightEnv * DOLPHIN_JUMP_PEAK - (1 - heightEnv) * 0.4;
      // Forward progress along the arc — covers a few units of water
      const forward = (t - 0.5) * 9;

      const sinH = Math.sin(pod.heading);
      const cosH = Math.cos(pod.heading);
      const lateralX = cosH * d.lateralOffset;
      const lateralZ = sinH * d.lateralOffset;

      const wx = pod.origin.x + sinH * forward + lateralX;
      const wz = pod.origin.z - cosH * forward + lateralZ;
      const wave = sampleWave(wx, wz, time);
      const wy = wave.height + yOff;

      d.holder.visible = true;
      d.holder.position.set(wx, wy, wz);
      d.holder.rotation.y = pod.heading;

      // Pitch follows the parabola's slope: up at start, down at end.
      // d/dt of 4t(1-t) = 4(1-2t); maps to pitch around 0.
      d.inner.rotation.x = (1 - 2 * t) * 0.95;
      // Slight roll for personality
      d.inner.rotation.z = Math.sin(time * 12 + d.timeOffset * 6) * 0.08;
    }

    if (pod.elapsed >= maxLocal && !anyVisible) {
      pod.active = false;
      pod.cooldown = randRange(DOLPHIN_COOLDOWN_MIN, DOLPHIN_COOLDOWN_MAX);
      for (const d of dolphins) {
        d.holder.visible = false;
      }
    }
  }

  function triggerPodJump(state: SurferState): void {
    pod.active = true;
    pod.elapsed = 0;

    // Spawn the pod somewhere visible — bias roughly perpendicular to the
    // surfer's heading so the jump shows up to the side rather than directly
    // ahead/behind.
    const surferHeading = state.heading;
    const sideSign = Math.random() < 0.5 ? -1 : 1;
    const angle = surferHeading + sideSign * (Math.PI / 2 + (Math.random() - 0.5) * 0.6);
    const distance = randRange(DOLPHIN_SPAWN_RING_MIN, DOLPHIN_SPAWN_RING_MAX);
    pod.origin.set(
      state.position.x + Math.sin(angle) * distance,
      0,
      state.position.z - Math.cos(angle) * distance,
    );
    // Heading: pod travels roughly across the player's view
    pod.heading = surferHeading + sideSign * Math.PI / 2 + (Math.random() - 0.5) * 0.5;
  }

  return { root, update };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function prepareModel(model: Object3D): Object3D {
  model.traverse((child) => {
    if (child instanceof Mesh) {
      child.castShadow = true;
      child.receiveShadow = false;
      // Some Quaternius/Polygonal Mind exports use MeshBasic — promote to
      // Standard so they catch the directional light like the rest of the
      // scene. Keep the existing colour where possible.
      if (!(child.material instanceof MeshStandardMaterial)) {
        const existing = child.material as { color?: Color } | null;
        const color = existing?.color ? existing.color.clone() : new Color('#a7b8c4');
        child.material = new MeshStandardMaterial({
          color,
          roughness: 0.78,
          metalness: 0.0,
        });
      }
    }
  });
  return model;
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
