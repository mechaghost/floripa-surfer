import {
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Clock,
  Color,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PCFSoftShadowMap,
  PlaneGeometry,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import './styles.css';
import { attachKeyboard, createInputState } from './game/input/inputState';
import type { SurferState } from './game/simulation/surfer';
import { createInitialSurferState, updateSurfer } from './game/simulation/surfer';
import { sampleWave } from './game/simulation/waves';
import { createOcean } from './render/ocean';
import { createPoseEditorView } from './render/poseEditor';
import { createSurferModel, getSurferRenderHeading } from './render/surferModel';
import { createWorld } from './render/world';
import { createHud } from './ui/hud';
import { createTouchControls } from './ui/touchControls';

type GameInternals = {
  scene: Scene;
  camera: PerspectiveCamera | OrthographicCamera;
  renderer: WebGLRenderer;
  getSurferState: () => SurferState;
  getCameraPosition: () => Vector3;
};

declare global {
  interface Window {
    floripaSurfer?: GameInternals;
  }
}

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('App root not found');
}

const shell = document.createElement('main');
shell.className = 'game';
app.append(shell);

const renderer = new WebGLRenderer({
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
shell.append(renderer.domElement);

const view = new URLSearchParams(window.location.search).get('view');

if (view === 'surfer-test') {
  createSurferVerificationView(shell, renderer);
} else if (view === 'pose-editor') {
  createPoseEditorView(shell, renderer);
} else {
  createGame(shell, renderer);
}

function createGame(shell: HTMLElement, renderer: WebGLRenderer): void {
const { scene, camera, updateCamera } = createWorld();
const ocean = createOcean();
const surfer = createSurferModel();
const spray = createSpray();
const contactFoam = createBoardContactFoam();
const wake = createBoardWake();
const waterCues = createWaterMotionCues();
const input = createInputState();
const hud = createHud();
const touchControls = createTouchControls(input);
const detachKeyboard = attachKeyboard(input);
const clock = new Clock();
let surferState = createInitialSurferState();
let elapsed = 0;

scene.add(ocean.mesh, contactFoam.root, wake.root, surfer.root, spray.root, waterCues.root);
shell.append(hud.root, touchControls.root);

window.addEventListener('resize', resize);
window.addEventListener('pagehide', dispose);
resize();
renderer.setAnimationLoop(tick);

function tick(): void {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  elapsed += dt;

  const wave = sampleWave(surferState.position.x, surferState.position.z, elapsed);
  surferState = updateSurfer(surferState, input, wave, dt);
  const currentWave = sampleWave(surferState.position.x, surferState.position.z, elapsed);

  ocean.update(elapsed, surferState.position);
  surfer.update(surferState, elapsed);
  contactFoam.update(surferState, currentWave.lipPower, elapsed);
  wake.update(surferState, currentWave.lipPower, elapsed, dt);
  spray.update(surferState, currentWave.lipPower, elapsed);
  waterCues.update(surferState, elapsed);
  updateCamera(surferState, dt);
  hud.update(surferState);
  renderer.render(scene, camera);
}

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function dispose(): void {
  renderer.setAnimationLoop(null);
  window.removeEventListener('resize', resize);
  detachKeyboard();
  touchControls.dispose();
  renderer.dispose();
}

type WaterMotionCues = {
  root: Group;
  update: (state: typeof surferState, time: number) => void;
};

function createWaterMotionCues(): WaterMotionCues {
  const root = new Group();
  const material = new MeshBasicMaterial({
    color: new Color('#c8f7ff'),
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
  });
  const geometry = new PlaneGeometry(0.34, 0.09);
  const flecks = Array.from({ length: 72 }, (_, index) => {
    const mesh = new Mesh(geometry, material.clone());
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 2;
    root.add(mesh);
    return { mesh, seed: index * 19.19 };
  });

  function update(state: typeof surferState, time: number): void {
    const spacingX = 8.5;
    const spacingZ = 7.2;
    const startX = Math.floor((state.position.x - 42) / spacingX) * spacingX;
    const startZ = Math.floor((state.position.z - 50) / spacingZ) * spacingZ;

    for (let i = 0; i < flecks.length; i += 1) {
      const col = i % 8;
      const row = Math.floor(i / 8);
      const seed = flecks[i].seed;
      const x = startX + col * spacingX + pseudo(seed) * 4.8;
      const z = startZ + row * spacingZ + pseudo(seed + 8.7) * 4.6;
      const wave = sampleWave(x, z, time);
      const mesh = flecks[i].mesh;
      mesh.position.set(x, wave.height + 0.035, z);
      mesh.rotation.z = -state.heading + pseudo(seed + 3.1) * 0.4 - 0.2;
      const speedStretch = Math.min(2.5, 0.7 + state.speed * 0.085);
      mesh.scale.set(speedStretch * (0.7 + pseudo(seed + 1.3) * 0.9), 1, 0.6 + wave.lipPower * 0.55);
      mesh.material.opacity = 0.18 + wave.facePower * 0.25 + pseudo(seed + 2.2) * 0.16;
    }
  }

  return { root, update };
}

function pseudo(value: number): number {
  const raw = Math.sin(value * 12.9898) * 43758.5453;
  return raw - Math.floor(raw);
}

type BoardContactFoam = {
  root: Group;
  update: (state: typeof surferState, lipPower: number, time: number) => void;
};

type ContactFoamPatch = {
  base: number;
  index: number;
  kind: 'rail' | 'noseTail';
  localA: { x: number; z: number };
  localB: { x: number; z: number };
  seed: number;
};

function createBoardContactFoam(): BoardContactFoam {
  const root = new Group();
  const positions: number[] = [];
  const uvs: number[] = [];
  const foams: number[] = [];
  const seeds: number[] = [];
  const indices: number[] = [];
  const patches: ContactFoamPatch[] = [];
  const boardHalfLength = 1.55;
  const boardHalfWidth = 0.34;
  const railFoamWidth = 0.36;
  const endFoamLength = 0.3;
  const railSegments = 20;
  const endSegments = 8;

  function addPatch(kind: ContactFoamPatch['kind'], localA: ContactFoamPatch['localA'], localB: ContactFoamPatch['localB'], seed: number): void {
    const base = positions.length / 3;
    positions.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
    foams.push(0, 0, 0, 0);
    seeds.push(seed, seed, seed, seed);
    indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
    patches.push({ base, index: patches.length, kind, localA, localB, seed });
  }

  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < railSegments; i += 1) {
      const z0 = -boardHalfLength + (i / railSegments) * boardHalfLength * 2;
      const z1 = -boardHalfLength + ((i + 1) / railSegments) * boardHalfLength * 2;
      addPatch(
        'rail',
        { x: side * boardHalfWidth, z: z0 },
        { x: side * (boardHalfWidth + railFoamWidth), z: z1 },
        i * 8.17 + side * 13.4,
      );
    }
  }

  for (let end = -1; end <= 1; end += 2) {
    for (let i = 0; i < endSegments; i += 1) {
      const x0 = -boardHalfWidth + (i / endSegments) * boardHalfWidth * 2;
      const x1 = -boardHalfWidth + ((i + 1) / endSegments) * boardHalfWidth * 2;
      addPatch(
        'noseTail',
        { x: x0, z: end * boardHalfLength },
        { x: x1, z: end * (boardHalfLength + endFoamLength) },
        70 + i * 9.11 + end * 21.3,
      );
    }
  }

  const geometry = new BufferGeometry();
  const positionAttribute = new BufferAttribute(new Float32Array(positions), 3);
  const foamAttribute = new BufferAttribute(new Float32Array(foams), 1);
  positionAttribute.setUsage(DynamicDrawUsage);
  foamAttribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setAttribute('aFoam', foamAttribute);
  geometry.setAttribute('aSeed', new BufferAttribute(new Float32Array(seeds), 1));
  geometry.setIndex(indices);

  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new Color('#efffff') },
    },
    vertexShader: `
      attribute float aFoam;
      attribute float aSeed;
      varying vec2 vUv;
      varying float vFoam;
      varying float vSeed;

      void main() {
        vUv = uv;
        vFoam = aFoam;
        vSeed = aSeed;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;

      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying float vFoam;
      varying float vSeed;

      float foamNoise(vec2 p) {
        float a = sin(p.x * 17.0 + p.y * 6.0 + uTime * 5.2 + vSeed);
        float b = sin(p.x * -9.0 + p.y * 21.0 - uTime * 4.1 + vSeed * 1.37);
        float c = sin((p.x + p.y) * 31.0 + uTime * 8.7 + vSeed * 0.61);
        return (a + b * 0.72 + c * 0.38) / 2.1;
      }

      void main() {
        float innerEdge = 1.0 - smoothstep(0.0, 0.18, vUv.y);
        float feather = 1.0 - smoothstep(0.55, 1.0, vUv.y);
        float lace = smoothstep(-0.34, 0.62, foamNoise(vUv + vec2(uTime * 0.16, -uTime * 0.09)));
        float bubbles = smoothstep(0.28, 0.92, foamNoise(vUv * vec2(2.8, 1.5) + vec2(vSeed, uTime * 0.23)));
        float alpha = vFoam * feather * (0.18 + lace * 0.52 + bubbles * 0.24);
        alpha *= 1.0 - innerEdge * 0.55;
        alpha *= 0.72;

        if (alpha < 0.01) {
          discard;
        }

        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 5;
  root.add(mesh);

  const tmpWorldA = new Vector3();
  const tmpWorldB = new Vector3();
  const tmpWorldC = new Vector3();
  const tmpWorldD = new Vector3();

  function update(state: typeof surferState, lipPower: number, time: number): void {
    const position = geometry.attributes.position as BufferAttribute;
    const foam = geometry.attributes.aFoam as BufferAttribute;
    const forwardX = Math.sin(state.heading);
    const forwardZ = -Math.cos(state.heading);
    const rightX = Math.cos(state.heading);
    const rightZ = Math.sin(state.heading);
    const boardPitch = Math.sin(state.pitch);
    const speedFoam = Math.min(1, Math.max(0, (state.speed - 3.2) / 8));
    material.uniforms.uTime.value = time;

    for (const patch of patches) {
      const localX0 = patch.localA.x;
      const localX1 = patch.localB.x;
      const localZ0 = patch.localA.z;
      const localZ1 = patch.localB.z;
      const sideSign = Math.sign((localX0 + localX1) * 0.5) || 1;
      const endSign = Math.sign((localZ0 + localZ1) * 0.5) || 1;

      setContactVertex(tmpWorldA, state, forwardX, forwardZ, rightX, rightZ, localX0, localZ0, time);
      setContactVertex(tmpWorldB, state, forwardX, forwardZ, rightX, rightZ, localX1, localZ0, time);
      setContactVertex(tmpWorldC, state, forwardX, forwardZ, rightX, rightZ, localX0, localZ1, time);
      setContactVertex(tmpWorldD, state, forwardX, forwardZ, rightX, rightZ, localX1, localZ1, time);

      const boardHeightA = state.height - boardPitch * localZ0;
      const boardHeightB = state.height - boardPitch * localZ1;
      const waterA = sampleWave(tmpWorldA.x, tmpWorldA.z, time);
      const waterB = sampleWave(tmpWorldD.x, tmpWorldD.z, time);
      const depthA = getContactDepth(waterA.height, boardHeightA);
      const depthB = getContactDepth(waterB.height, boardHeightB);
      const plowBias = patch.kind === 'rail'
        ? Math.max(0, sideSign * state.turn) * 0.22
        : (endSign > 0 ? lipPower * 0.35 : 0.18);
      const intensity = Math.min(1, (depthA + depthB) * 0.5 * (0.55 + speedFoam * 0.75) + plowBias);
      const pulse = 0.84 + Math.sin(time * 7.4 + patch.seed) * 0.09 + pseudo(patch.seed + time * 0.23) * 0.08;
      const alpha = intensity * pulse;

      writePosition(position, patch.base, tmpWorldA);
      writePosition(position, patch.base + 1, tmpWorldB);
      writePosition(position, patch.base + 2, tmpWorldC);
      writePosition(position, patch.base + 3, tmpWorldD);
      foam.setX(patch.base, alpha * 0.85);
      foam.setX(patch.base + 1, alpha);
      foam.setX(patch.base + 2, alpha * 0.58);
      foam.setX(patch.base + 3, alpha * 0.7);
    }

    position.needsUpdate = true;
    foam.needsUpdate = true;
    geometry.computeBoundingSphere();
  }

  return { root, update };
}

function setContactVertex(
  target: Vector3,
  state: SurferState,
  forwardX: number,
  forwardZ: number,
  rightX: number,
  rightZ: number,
  localX: number,
  localZ: number,
  time: number,
): void {
  const x = state.position.x + rightX * localX + forwardX * localZ;
  const z = state.position.z + rightZ * localX + forwardZ * localZ;
  const wave = sampleWave(x, z, time);
  const fizz = Math.sin(time * 9.5 + localX * 7.7 + localZ * 3.1) * 0.018;
  target.set(x, wave.height + 0.058 + fizz, z);
}

function writePosition(attribute: BufferAttribute, index: number, position: Vector3): void {
  attribute.setXYZ(index, position.x, position.y, position.z);
}

type Spray = {
  root: Group;
  update: (state: typeof surferState, lipPower: number, time: number) => void;
};

function createSpray(): Spray {
  const root = new Group();
  const halfBoardLength = 1.35;
  const material = new MeshBasicMaterial({
    color: new Color('#d8f9ff'),
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
  });
  const geometry = new SphereGeometry(0.083, 7, 5);
  const particles = Array.from({ length: 96 }, (_, index) => {
    const mesh = new Mesh(geometry, material.clone());
    const lane = index % 2 === 0 ? -1 : 1;
    const emitter = index < 66 ? 'tail' : 'nose';
    const seed = index * 9.37 + 1.2;
    const sideBias = 0.04 + pseudo(seed) * 0.14;
    const sideVelocity = lane * (0.48 + pseudo(seed + 0.7) * 1.18);
    const liftVelocity = 0.1 + pseudo(seed + 1.3) * 0.28;
    const backVelocity = 1 + pseudo(seed + 2.1) * 2.2;
    const lifetime = 0.38 + pseudo(seed + 3.8) * 0.42;
    const phase = pseudo(seed + 5.4) * lifetime;
    root.add(mesh);
    return {
      mesh,
      emitter,
      lane,
      seed,
      sideBias,
      sideVelocity,
      liftVelocity,
      backVelocity,
      lifetime,
      phase,
      size: 0.24 + pseudo(seed + 6.6) * 0.51,
    };
  });

  function update(state: typeof surferState, lipPower: number, time: number): void {
    root.position.set(
      state.position.x,
      state.height + 0.08,
      state.position.z,
    );
    root.rotation.y = getSurferRenderHeading(state.heading);

    const forwardX = Math.sin(state.heading);
    const forwardZ = -Math.cos(state.heading);
    const pitchRise = Math.sin(state.pitch) * halfBoardLength;
    const noseX = state.position.x + forwardX * halfBoardLength;
    const noseZ = state.position.z + forwardZ * halfBoardLength;
    const tailX = state.position.x - forwardX * halfBoardLength;
    const tailZ = state.position.z - forwardZ * halfBoardLength;
    const noseDepth = getContactDepth(sampleWave(noseX, noseZ, time).height, state.height - pitchRise);
    const tailDepth = getContactDepth(sampleWave(tailX, tailZ, time).height, state.height + pitchRise);
    const intensity = Math.min(1, 0.2 + lipPower * 0.65 + state.speed * 0.025);
    for (const particle of particles) {
      const isTail = particle.emitter === 'tail';
      const contactDepth = isTail ? tailDepth : noseDepth;
      const emitterIntensity = intensity * Math.min(1, isTail ? 0.55 + contactDepth * 1.7 : contactDepth * 3.2);
      const cycle = (time * (1.05 + state.speed * 0.05) + particle.phase) % particle.lifetime;
      const age = cycle / particle.lifetime;
      const turbulence = Math.sin(time * 11 + particle.seed) * 0.12 + Math.sin(time * 4.6 + particle.seed * 1.7) * 0.07;
      const gravityDrop = age * age * 0.52;
      const wakePush = 0.82 + state.speed * 0.07 + lipPower * 0.55 + contactDepth * 0.85;
      const fleckSize = emitterIntensity * particle.size * (1 - age * 0.78);
      const foamStretch = 1.1 + age * 2.1 + state.speed * 0.018;
      const originZ = isTail ? 0.78 : -0.92;
      const zDirection = isTail ? 1 : -0.58;
      const liftBoost = isTail ? 1 : 1.45;

      particle.mesh.position.x =
        particle.lane * particle.sideBias +
        particle.sideVelocity * age * wakePush * (isTail ? 1 : 1.35) +
        turbulence * (0.5 + age);
      particle.mesh.position.y =
        particle.liftVelocity * age * liftBoost +
        contactDepth * 0.16 * (1 - age) -
        gravityDrop +
        Math.sin(time * 11 + particle.seed) * 0.035;
      particle.mesh.position.z =
        originZ +
        particle.backVelocity * age * wakePush * zDirection +
        Math.sin(time * 7.6 + particle.seed) * 0.13 * age;
      particle.mesh.scale.set(
        Math.max(0.018, fleckSize * (0.65 + age * 1.05)),
        Math.max(0.009, fleckSize * 0.14),
        Math.max(0.027, fleckSize * foamStretch),
      );
      particle.mesh.material.opacity = Math.max(0, emitterIntensity * (0.68 - age * 0.62));
    }
  }

  return { root, update };
}

type BoardWake = {
  root: Group;
  update: (state: typeof surferState, lipPower: number, time: number, dt: number) => void;
};

function createBoardWake(): BoardWake {
  const root = new Group();
  const material = new MeshBasicMaterial({
    color: new Color('#e8fbff'),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  });
  const geometry = new PlaneGeometry(1.2, 0.22);
  const wakes = Array.from({ length: 82 }, (_, index) => {
    const mesh = new Mesh(geometry, material.clone());
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 3;
    root.add(mesh);
    return {
      mesh,
      age: 999,
      lifetime: 1.15 + pseudo(index * 4.33) * 0.82,
      seed: index * 15.77 + 2.4,
      side: index % 2 === 0 ? -1 : 1,
      drift: 0,
      stretch: 1,
      heading: 0,
    };
  });
  let cursor = 0;
  let emitCarry = 0;

  function spawnWake(state: typeof surferState, lipPower: number, time: number): void {
    const wake = wakes[cursor];
    cursor = (cursor + 1) % wakes.length;

    const forwardX = Math.sin(state.heading);
    const forwardZ = -Math.cos(state.heading);
    const rightX = Math.cos(state.heading);
    const rightZ = Math.sin(state.heading);
    const side = wake.side;
    const sideSpread = side * (0.22 + pseudo(wake.seed + time) * 0.42);
    const tailOffset = 1.34 + pseudo(wake.seed + 3.1) * 0.46;
    const stagger = pseudo(wake.seed + time * 0.17) * 0.44;
    const x = state.position.x - forwardX * (tailOffset + stagger) + rightX * sideSpread;
    const z = state.position.z - forwardZ * (tailOffset + stagger) + rightZ * sideSpread;
    const water = sampleWave(x, z, time);

    wake.age = 0;
    wake.lifetime = 0.84 + pseudo(wake.seed + time * 0.4) * 0.82 + lipPower * 0.32;
    wake.drift = side * (0.2 + pseudo(wake.seed + 5.5) * 0.55);
    wake.stretch = 0.78 + state.speed * 0.055 + lipPower * 0.42 + pseudo(wake.seed + 6.4) * 0.38;
    wake.heading = getSurferRenderHeading(state.heading) + side * (0.06 + pseudo(wake.seed + 7.3) * 0.12);
    wake.mesh.position.set(x, water.height + 0.042, z);
    wake.mesh.rotation.z = wake.heading;
  }

  function update(state: typeof surferState, lipPower: number, time: number, dt: number): void {
    const waterAtBoard = sampleWave(state.position.x, state.position.z, time).height;
    const boardClearance = state.height - waterAtBoard;
    const boardInWater = Math.min(1, Math.max(0, (0.08 - boardClearance) / 0.08));
    const speedWake = Math.min(1, Math.max(0, (state.speed - 1.2) / 4));
    const emitRate = boardInWater > 0.05 ? boardInWater * speedWake * Math.min(52, 12 + state.speed * 1.9 + lipPower * 18) : 0;
    emitCarry += emitRate * dt;
    if (emitRate === 0) {
      emitCarry = 0;
    }
    while (emitCarry >= 1) {
      spawnWake(state, lipPower, time);
      emitCarry -= 1;
    }

    for (const wake of wakes) {
      wake.age += dt;
      const life = Math.min(1, wake.age / wake.lifetime);
      if (life >= 1) {
        wake.mesh.material.opacity = 0;
        continue;
      }

      const fade = Math.pow(1 - life, 1.65);
      const ripple = Math.sin(time * 10.5 + wake.seed) * 0.035;
      const water = sampleWave(wake.mesh.position.x, wake.mesh.position.z, time);
      wake.mesh.position.y = water.height + 0.045 + ripple;
      wake.mesh.position.x += Math.cos(wake.heading) * wake.drift * dt * (0.28 + life);
      wake.mesh.position.z += Math.sin(wake.heading) * wake.drift * dt * (0.28 + life);
      wake.mesh.rotation.z = wake.heading + Math.sin(time * 2.8 + wake.seed) * 0.06 * life;
      wake.mesh.scale.set(
        wake.stretch * (0.55 + life * 2.15),
        0.5 + life * 1.55,
        1,
      );
      wake.mesh.material.opacity = Math.min(0.62, fade * (0.34 + lipPower * 0.22));
    }
  }

  return { root, update };
}

function getContactDepth(waterHeight: number, boardHeight: number): number {
  return Math.min(1, Math.max(0, (waterHeight - boardHeight + 0.22) * 1.4));
}

window.floripaSurfer = {
  scene,
  camera,
  renderer,
  getSurferState: () => surferState,
  getCameraPosition: () => camera.position.clone(),
};
}

type VerificationPanel = {
  label: string;
  camera: OrthographicCamera;
};

function createSurferVerificationView(shell: HTMLElement, renderer: WebGLRenderer): void {
  shell.classList.add('game--verify');

  const scene = new Scene();
  scene.background = new Color('#b7eef4');
  scene.add(new AmbientLight('#ffffff', 2.2));
  const keyLight = new DirectionalLight('#ffffff', 3.6);
  keyLight.position.set(3, 6, 4);
  scene.add(keyLight);
  const fillLight = new DirectionalLight('#c8f7ff', 1.4);
  fillLight.position.set(-4, 3, -5);
  scene.add(fillLight);
  const surfer = createSurferModel();
  const state = createInitialSurferState();
  state.position = { x: 0, z: 0 };
  state.height = 0;
  state.heading = 0;
  state.pitch = 0;
  state.bank = 0;
  state.speed = 0;

  scene.add(surfer.root);
  scene.add(createVerificationDeck());

  const panels = createVerificationPanels();
  const labels = createVerificationLabels(shell, panels.map((panel) => panel.label));

  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', dispose);
  resize();
  renderer.setAnimationLoop(render);

  function render(): void {
    surfer.update(state, 0);
    renderer.setScissorTest(true);

    const width = renderer.domElement.clientWidth;
    const height = renderer.domElement.clientHeight;
    const halfWidth = Math.floor(width / 2);
    const halfHeight = Math.floor(height / 2);

    panels.forEach((panel, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = col * halfWidth;
      const y = height - (row + 1) * halfHeight;
      const viewportWidth = col === 0 ? halfWidth : width - halfWidth;
      const viewportHeight = row === 0 ? halfHeight : height - halfHeight;
      panel.camera.updateProjectionMatrix();
      renderer.setViewport(x, y, viewportWidth, viewportHeight);
      renderer.setScissor(x, y, viewportWidth, viewportHeight);
      renderer.render(scene, panel.camera);
    });

    renderer.setScissorTest(false);
  }

  function resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height);
    for (const panel of panels) {
      const aspect = (width / 2) / (height / 2);
      panel.camera.left = -2.5 * aspect;
      panel.camera.right = 2.5 * aspect;
      panel.camera.top = 2.5;
      panel.camera.bottom = -2.5;
    }
    updateVerificationLabels(labels);
  }

  function dispose(): void {
    renderer.setAnimationLoop(null);
    window.removeEventListener('resize', resize);
    renderer.dispose();
  }

  window.floripaSurfer = {
    scene,
    camera: panels[0].camera,
    renderer,
    getSurferState: () => state,
    getCameraPosition: () => panels[0].camera.position.clone(),
  };
}

function createVerificationPanels(): VerificationPanel[] {
  const cameras = [
    { label: 'FRONT / NOSE', position: new Vector3(0, 1.25, -5.8), up: new Vector3(0, 1, 0) },
    { label: 'LEFT SIDE', position: new Vector3(-5.8, 1.25, 0), up: new Vector3(0, 1, 0) },
    { label: 'RIGHT SIDE', position: new Vector3(5.8, 1.25, 0), up: new Vector3(0, 1, 0) },
    { label: 'TOP', position: new Vector3(0, 7.2, 0), up: new Vector3(0, 0, -1) },
  ];

  return cameras.map(({ label, position, up }) => {
    const camera = new OrthographicCamera(-2.5, 2.5, 2.5, -2.5, 0.1, 30);
    camera.position.copy(position);
    camera.up.copy(up);
    camera.lookAt(0, 0.7, 0);
    return { label, camera };
  });
}

function createVerificationDeck(): Group {
  const root = new Group();
  const material = new MeshBasicMaterial({
    color: new Color('#ffffff'),
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
  });
  const center = new Mesh(new PlaneGeometry(0.08, 4.2), material);
  center.rotation.x = -Math.PI / 2;
  center.position.y = 0.022;
  root.add(center);

  const cross = new Mesh(new PlaneGeometry(1.7, 0.05), material.clone());
  cross.rotation.x = -Math.PI / 2;
  cross.position.y = 0.024;
  root.add(cross);
  return root;
}

function createVerificationLabels(shell: HTMLElement, panelLabels: string[]): HTMLElement[] {
  const overlay = document.createElement('div');
  overlay.className = 'verify-labels';
  shell.append(overlay);

  return panelLabels.map((label) => {
    const item = document.createElement('div');
    item.className = 'verify-label';
    item.textContent = label;
    overlay.append(item);
    return item;
  });
}

function updateVerificationLabels(labels: HTMLElement[]): void {
  const positions = [
    { left: '14px', top: '14px' },
    { left: 'calc(50% + 14px)', top: '14px' },
    { left: '14px', top: 'calc(50% + 14px)' },
    { left: 'calc(50% + 14px)', top: 'calc(50% + 14px)' },
  ];

  labels.forEach((label, index) => {
    label.style.left = positions[index].left;
    label.style.top = positions[index].top;
  });
}
