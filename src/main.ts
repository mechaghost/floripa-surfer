import {
  AdditiveBlending,
  AmbientLight,
  Clock,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PCFSoftShadowMap,
  PlaneGeometry,
  PerspectiveCamera,
  Quaternion,
  Scene,
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
import { getBoardWaterContact } from './render/waterContact';
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
const foamField = createLowPolyFoamField();
const input = createInputState();
const hud = createHud();
const touchControls = createTouchControls(input, renderer.domElement);
const poseEditorLink = createPoseEditorLink();
const detachKeyboard = attachKeyboard(input);
const clock = new Clock();
let surferState = createInitialSurferState();
let elapsed = 0;

scene.add(ocean.mesh, foamField.root, contactFoam.root, wake.root, surfer.root, spray.root, waterCues.root);
shell.append(hud.root, touchControls.root, poseEditorLink);

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
  foamField.update(surferState, elapsed);
  surfer.update(surferState, elapsed);
  contactFoam.update(surferState, currentWave.lipPower, elapsed, dt);
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
    color: new Color('#b9fbff'),
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const geometry = new PlaneGeometry(1.15, 0.08);
  const flecks = Array.from({ length: 104 }, (_, index) => {
    const mesh = new Mesh(geometry, material.clone());
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 2;
    root.add(mesh);
    return {
      mesh,
      seed: index * 19.19,
      length: 1 + pseudo(index * 4.21) * 2.4,
      width: 0.45 + pseudo(index * 7.9) * 0.55,
    };
  });

  function update(state: typeof surferState, time: number): void {
    const spacingX = 7.4;
    const spacingZ = 5.8;
    const startX = Math.floor((state.position.x - 48) / spacingX) * spacingX;
    const startZ = Math.floor((state.position.z - 42) / spacingZ) * spacingZ;

    for (let i = 0; i < flecks.length; i += 1) {
      const col = i % 13;
      const row = Math.floor(i / 13);
      const seed = flecks[i].seed;
      const drift = wrap01(time * (0.06 + state.speed * 0.008) + pseudo(seed + 1.7));
      const x = startX + col * spacingX + pseudo(seed) * 4.8 + Math.sin(time * 0.35 + seed) * 0.22;
      const z = startZ + (row + drift) * spacingZ + pseudo(seed + 8.7) * 3.2;
      const wave = sampleWave(x, z, time);
      const cue = flecks[i];
      const mesh = cue.mesh;
      const localZ = z - state.position.z;
      const aheadFade = smoothstep(-38, -12, localZ) * (1 - smoothstep(34, 54, localZ));
      const speedStretch = 0.7 + Math.min(2.4, state.speed * 0.09);

      mesh.position.set(x, wave.height + 0.045, z);
      mesh.rotation.z = -state.heading + pseudo(seed + 3.1) * 0.42 - 0.21;
      mesh.scale.set(cue.length * speedStretch, cue.width * (0.7 + wave.lipPower * 0.35), 1);
      mesh.material.opacity = aheadFade * (0.16 + wave.facePower * 0.12 + pseudo(seed + 2.2) * 0.08);
    }
  }

  return { root, update };
}

function pseudo(value: number): number {
  const raw = Math.sin(value * 12.9898) * 43758.5453;
  return raw - Math.floor(raw);
}

type LowPolyFoamField = {
  root: Group;
  update: (state: typeof surferState, time: number) => void;
};

function createLowPolyFoamField(): LowPolyFoamField {
  const root = new Group();
  const columns = 42;
  const crestBands = 6;
  const lanesPerBand = 3;
  const rows = crestBands * lanesPerBand;
  const count = columns * rows;
  const spacingX = 4.8;
  const primaryCrestPeriod = (Math.PI * 2) / 0.12;
  const geometry = new IcosahedronGeometry(1, 1);
  const material = new MeshStandardMaterial({
    color: new Color('#f1ffff'),
    roughness: 0.68,
    flatShading: true,
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
  });
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  root.add(mesh);

  const flecks = Array.from({ length: count }, (_, index) => {
    const seed = index * 23.11 + 4.7;
    return {
      seed,
      offsetX: (pseudo(seed + 1.1) - 0.5) * 3.1,
      offsetZ: (pseudo(seed + 2.3) - 0.5) * 0.85,
      scale: 0.058 + Math.pow(pseudo(seed + 3.9), 1.45) * 0.3,
      cluster: pseudo(seed + 7.5),
    };
  });
  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const rotation = new Quaternion();
  const upAxis = new Vector3(0, 1, 0);
  const hiddenScale = new Vector3(0.001, 0.001, 0.001);

  function update(state: typeof surferState, time: number): void {
    const startX = Math.floor((state.position.x - columns * spacingX * 0.5) / spacingX) * spacingX;
    const firstCrestIndex = Math.floor(((state.position.z - 82) * 0.12 + time * 1.35 - Math.PI / 2) / (Math.PI * 2));

    flecks.forEach((fleck, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const band = Math.floor(row / lanesPerBand);
      const lane = row % lanesPerBand;
      const crestIndex = firstCrestIndex + band;
      const laneOffset = (lane - (lanesPerBand - 1) / 2) * 0.88;
      const x = startX + column * spacingX + fleck.offsetX;
      const crestZ = (Math.PI / 2 - time * 1.35) / 0.12 + crestIndex * primaryCrestPeriod;
      const z =
        crestZ +
        laneOffset +
        fleck.offsetZ +
        Math.sin(x * 0.08 + time * 0.45 + fleck.seed * 0.03) * 0.72;
      const foam = getWaveFoamSystem(x, z, time);
      const wave = foam.wave;
      const distantWeight = smoothstep(0.02, 0.5, band / Math.max(1, crestBands - 1));
      const clump = Math.sin(x * 0.23 + z * 0.08 + fleck.seed * 0.31 + time * 0.08) * 0.5 + 0.5;
      const clusterWeight = 0.42 + smoothstep(0.18, 0.86, clump + fleck.cluster * 0.16) * 0.58;
      const laneWeight = lane === 1 ? 1 : 0.58;
      const size = fleck.scale * clusterWeight * laneWeight * foam.intensity * (0.62 + distantWeight * 0.8);

      if (size < 0.013) {
        matrix.compose(position.set(x, wave.height, z), rotation, hiddenScale);
        mesh.setMatrixAt(index, matrix);
        return;
      }

      rotation.setFromAxisAngle(upAxis, foam.heading + (pseudo(fleck.seed + 12.4) - 0.5) * 0.5);
      position.set(
        x + Math.sin(time * 0.7 + fleck.seed) * 0.06,
        wave.height + size * 0.64,
        z + Math.cos(time * 0.55 + fleck.seed) * 0.06,
      );
      scale.setScalar(size * (0.92 + foam.crestStrength * 0.24));
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(index, matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  }

  return { root, update };
}

type BoardContactFoam = {
  root: Group;
  update: (state: typeof surferState, lipPower: number, time: number, dt: number) => void;
};

type FoamBubble = {
  kind: 'rail' | 'wash' | 'splash';
  side: -1 | 1;
  offset: number;
  speed: number;
  radius: number;
  sizeMultiplier: number;
  lift: number;
  wobble: number;
  currentScale: number;
  seed: number;
};

type FoamContactProfile = {
  contact: number;
  size: number;
  lift: number;
  splash: number;
};

function createBoardContactFoam(): BoardContactFoam {
  const root = new Group();
  const bubbles: FoamBubble[] = [];
  const count = 220;
  const boardHalfLength = 1.55;
  const boardHalfWidth = 0.34;

  for (let index = 0; index < count; index += 1) {
    const seed = index * 11.73 + 5.1;
    const mix = index / count;
    const kind: FoamBubble['kind'] = mix < 0.74 ? 'rail' : mix < 0.84 ? 'splash' : 'wash';
    bubbles.push({
      kind,
      side: index % 2 === 0 ? -1 : 1,
      offset: pseudo(seed + 0.2),
      speed: 0.045 + pseudo(seed + 1.7) * 0.16,
      radius: 0.018 + pseudo(seed + 2.4) * 0.016,
      sizeMultiplier:
        (kind === 'splash' ? 1.05 : 0.82) +
        Math.pow(pseudo(seed + 7.2), 1.35) * (kind === 'splash' ? 3.1 : 2.45),
      lift: 0.018 + pseudo(seed + 3.8) * 0.055,
      wobble: 0.018 + pseudo(seed + 4.6) * 0.075,
      currentScale: 0,
      seed,
    });
  }

  const geometry = new IcosahedronGeometry(1, 1);
  const material = new MeshStandardMaterial({
    color: new Color('#f2ffff'),
    roughness: 0.62,
    flatShading: true,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  root.add(mesh);

  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const rotation = new Quaternion();
  const axis = new Vector3();
  const hiddenScale = new Vector3(0.001, 0.001, 0.001);

  function update(state: typeof surferState, lipPower: number, time: number, dt: number): void {
    const forwardX = Math.sin(state.heading);
    const forwardZ = -Math.cos(state.heading);
    const rightX = Math.cos(state.heading);
    const rightZ = Math.sin(state.heading);
    const boardPitch = Math.sin(state.pitch);
    const speedFoam = Math.min(1, Math.max(0, (state.speed - 3.2) / 8));
    const airborneGate = state.airtime > 0 || state.verticalVelocity > 0.08 ? 0 : 1;

    bubbles.forEach((bubble, index) => {
      const loop = wrap01(bubble.offset + time * bubble.speed + Math.sin(time * 0.45 + bubble.seed) * 0.02);
      let localX = 0;
      let localZ = 0;
      let splashArc = 0;
      let overBoard = 0;

      if (bubble.kind === 'rail') {
        const drift = Math.sin(time * 3.3 + bubble.seed) * bubble.wobble;
        localZ = boardHalfLength * 0.86 - loop * boardHalfLength * 1.76 + drift;
        const width = getBoardHalfWidthAt(localZ, boardHalfLength, boardHalfWidth);
        const railNoise = Math.sin(time * 1.2 + bubble.seed * 1.47) * 0.5 + 0.5;
        localX = bubble.side * (width + 0.025 + railNoise * 0.055);
      } else if (bubble.kind === 'splash') {
        const arcPhase = Math.sin(loop * Math.PI);
        const cross = Math.sin(loop * Math.PI * 1.15 + bubble.seed) * 0.105;
        localZ = boardHalfLength * 0.58 - loop * boardHalfLength * 1.52;
        const width = getBoardHalfWidthAt(localZ, boardHalfLength, boardHalfWidth);
        localX = bubble.side * (width * (0.42 - loop * 0.48)) + cross;
        splashArc = arcPhase * (0.075 + bubble.lift * 0.62);
        overBoard = 1 - smoothstep(0.5, 0.92, Math.abs(localX) / Math.max(0.08, width));
      } else {
        const walk = loop * Math.PI * 2;
        localZ = -boardHalfLength * 0.9 - loop * 0.52 + Math.sin(walk + bubble.seed) * 0.08;
        localX = Math.sin(walk + bubble.seed) * (boardHalfWidth + 0.12) + Math.sin(time * 3.9 + bubble.seed) * 0.045;
      }

      const x = state.position.x + rightX * localX + forwardX * localZ;
      const z = state.position.z + rightZ * localX + forwardZ * localZ;
      const water = sampleWave(x, z, time);
      const boardHeight = state.height - boardPitch * localZ - Math.sin(state.bank) * localX * 0.42;
      const contactProfile = getFoamContactProfile(water.height, boardHeight);
      const pressureBias = bubble.kind === 'rail'
        ? Math.max(0, bubble.side * state.turn) * 0.08
        : bubble.kind === 'splash'
          ? lipPower * 0.1 + overBoard * 0.06
          : 0.07;
      const contact = Math.min(
        1,
        contactProfile.contact * (0.58 + speedFoam * 0.34 + pressureBias) * airborneGate,
      );
      const softNoise = Math.sin(time * 1.35 + bubble.seed * 2.18) * 0.5 + 0.5;
      const pulse = 0.75 + Math.sin(time * 6.2 + bubble.seed) * 0.06 + softNoise * 0.06;
      const targetSize = bubble.radius * bubble.sizeMultiplier * Math.max(0, contact * pulse) * contactProfile.size;
      bubble.currentScale = dampScalar(bubble.currentScale, targetSize, targetSize > bubble.currentScale ? 7 : 44, dt);

      if (bubble.currentScale < 0.0028) {
        matrix.compose(position.set(x, water.height, z), rotation, hiddenScale);
        mesh.setMatrixAt(index, matrix);
        return;
      }

      const orbit = time * (2.6 + bubble.speed * 10) + bubble.seed;
      const bob = (Math.sin(orbit) * bubble.lift + Math.sin(orbit * 1.9) * 0.015) * contactProfile.lift;
      const waterLineY = water.height + 0.026 + bob + bubble.currentScale * 0.32;
      const splashY = boardHeight + 0.11 + splashArc + Math.sin(orbit * 1.7) * 0.018;
      const splashLift = bubble.kind === 'splash'
        ? contactProfile.splash * Math.max(0, splashY - waterLineY)
        : 0;
      position.set(
        x + Math.sin(orbit * 0.73) * 0.016,
        waterLineY + splashLift,
        z + Math.cos(orbit * 0.61) * 0.016,
      );
      scale.setScalar(bubble.currentScale * (0.9 + Math.sin(orbit * 1.23) * 0.12));
      axis.set(Math.sin(bubble.seed), 1, Math.cos(bubble.seed * 1.3)).normalize();
      rotation.setFromAxisAngle(axis, orbit * 0.37);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(index, matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  }

  return { root, update };
}

function wrap01(value: number): number {
  return value - Math.floor(value);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

type WaveFoamSystem = {
  wave: ReturnType<typeof sampleWave>;
  intensity: number;
  crestStrength: number;
  heading: number;
};

function getWaveFoamSystem(x: number, z: number, time: number): WaveFoamSystem {
  const wave = sampleWave(x, z, time);
  const primaryCrest = smoothstep(0.76, 0.99, Math.sin(z * 0.12 + time * 1.35));
  const secondaryCrest = smoothstep(0.8, 0.98, Math.sin(z * 0.21 + x * 0.08 + time * 1.9)) * 0.72;
  const barrelCrest = smoothstep(0.48, 0.95, Math.max(0, Math.sin(z * 0.075 - time * 0.85 + 1.5))) * 0.9;
  const crestStrength = Math.min(1, Math.max(primaryCrest, secondaryCrest, barrelCrest));
  const breakingEnergy = Math.max(smoothstep(0.62, 0.98, wave.lipPower) * 0.85, smoothstep(0.48, 2.2, wave.height));
  const faceSupport = smoothstep(0.38, 0.78, wave.facePower);
  const intensity = Math.min(1, crestStrength * breakingEnergy * (0.55 + faceSupport * 0.45));
  const slopeZ = Math.abs(wave.slopeZ) < 0.001 ? 0.001 : wave.slopeZ;

  return {
    wave,
    intensity,
    crestStrength,
    heading: Math.atan2(wave.slopeX, slopeZ),
  };
}

function getBoardHalfWidthAt(localZ: number, boardHalfLength: number, boardHalfWidth: number): number {
  const normalized = Math.min(1, Math.abs(localZ) / boardHalfLength);
  const noseTailTaper = smoothstep(0.5, 1, normalized);
  return boardHalfWidth * (1 - noseTailTaper * 0.56);
}

function getFoamContactProfile(waterHeight: number, boardHeight: number): FoamContactProfile {
  const submersion = waterHeight - boardHeight;
  const touchesWater = smoothstep(-0.045, 0.055, submersion);
  const deepSubmersion = smoothstep(0.12, 0.58, submersion);
  const surfaceRelease = 1 - deepSubmersion;

  return {
    contact: touchesWater * (0.34 + surfaceRelease * 0.66),
    size: 0.3 + surfaceRelease * 0.7,
    lift: 0.38 + surfaceRelease * 0.62,
    splash: touchesWater * surfaceRelease,
  };
}

function dampScalar(current: number, target: number, smoothing: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-smoothing * dt));
}

type Spray = {
  root: Group;
  update: (state: typeof surferState, lipPower: number, time: number) => void;
};

function createSpray(): Spray {
  const root = new Group();
  const halfBoardLength = 1.35;
  const material = new MeshStandardMaterial({
    color: new Color('#d8f9ff'),
    roughness: 0.7,
    flatShading: true,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
  });
  const geometry = new IcosahedronGeometry(0.083, 1);
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
    const waterAtBoard = sampleWave(state.position.x, state.position.z, time).height;
    const boardContact = getBoardWaterContact(state, waterAtBoard);
    const noseDepth = getContactDepth(sampleWave(noseX, noseZ, time).height, state.height - pitchRise) * boardContact;
    const tailDepth = getContactDepth(sampleWave(tailX, tailZ, time).height, state.height + pitchRise) * boardContact;
    const intensity = Math.min(1, 0.2 + lipPower * 0.65 + state.speed * 0.025);
    for (const particle of particles) {
      const isTail = particle.emitter === 'tail';
      const contactDepth = isTail ? tailDepth : noseDepth;
      const emitterIntensity = intensity * Math.min(1, contactDepth * (isTail ? 2.4 : 3.2));
      const cycle = (time * (1.05 + state.speed * 0.05) + particle.phase) % particle.lifetime;
      const age = cycle / particle.lifetime;
      const turbulence = Math.sin(time * 11 + particle.seed) * 0.12 + Math.sin(time * 4.6 + particle.seed * 1.7) * 0.07;
      const gravityDrop = age * age * 0.52;
      const wakePush = 0.82 + state.speed * 0.07 + lipPower * 0.55 + contactDepth * 0.85;
      const fleckSize = emitterIntensity * particle.size * (1 - age * 0.78);
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
      particle.mesh.scale.setScalar(Math.max(0.018, fleckSize * (0.68 + age * 0.72)));
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
  const material = new MeshStandardMaterial({
    color: new Color('#e8fbff'),
    roughness: 0.66,
    flatShading: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const geometry = new IcosahedronGeometry(1, 1);
  const wakes = Array.from({ length: 82 }, (_, index) => {
    const mesh = new Mesh(geometry, material.clone());
    mesh.renderOrder = 3;
    root.add(mesh);
    return {
      mesh,
      age: 999,
      lifetime: 1.15 + pseudo(index * 4.33) * 0.82,
      seed: index * 15.77 + 2.4,
      side: index % 2 === 0 ? -1 : 1,
      drift: 0,
      heading: 0,
      baseRadius: 0.032 + pseudo(index * 8.81) * 0.052,
      radius: 0.032,
      contact: 0,
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
    const localX = sideSpread;
    const localZ = -(tailOffset + stagger);
    const x = state.position.x + forwardX * localZ + rightX * localX;
    const z = state.position.z + forwardZ * localZ + rightZ * localX;
    const water = sampleWave(x, z, time);
    const boardPitch = Math.sin(state.pitch);
    const boardHeight = state.height - boardPitch * localZ - Math.sin(state.bank) * localX * 0.42;
    const contactProfile = getFoamContactProfile(water.height, boardHeight);

    wake.age = 0;
    wake.lifetime = 0.84 + pseudo(wake.seed + time * 0.4) * 0.82 + lipPower * 0.32;
    wake.drift = side * (0.2 + pseudo(wake.seed + 5.5) * 0.55);
    wake.heading = getSurferRenderHeading(state.heading) + side * (0.06 + pseudo(wake.seed + 7.3) * 0.12);
    wake.radius = wake.baseRadius * (0.42 + contactProfile.size * 0.58);
    wake.contact = contactProfile.contact;
    wake.mesh.position.set(x, water.height + 0.042, z);
    wake.mesh.rotation.z = wake.heading;
  }

  function update(state: typeof surferState, lipPower: number, time: number, dt: number): void {
    const forwardX = Math.sin(state.heading);
    const forwardZ = -Math.cos(state.heading);
    const boardPitch = Math.sin(state.pitch);
    const tailX = state.position.x - forwardX * 1.38;
    const tailZ = state.position.z - forwardZ * 1.38;
    const tailWater = sampleWave(tailX, tailZ, time);
    const tailBoardHeight = state.height + boardPitch * 1.38;
    const tailContact = getFoamContactProfile(tailWater.height, tailBoardHeight);
    const boardInWater = state.airtime > 0 || state.verticalVelocity > 0.08 ? 0 : tailContact.contact;
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
      const radius = wake.radius * (0.78 + life * 0.54 + lipPower * 0.16);
      wake.mesh.position.y = water.height + radius * 0.58 + ripple;
      wake.mesh.position.x += Math.cos(wake.heading) * wake.drift * dt * (0.28 + life);
      wake.mesh.position.z += Math.sin(wake.heading) * wake.drift * dt * (0.28 + life);
      wake.mesh.rotation.set(
        time * 0.24 + wake.seed,
        wake.heading + Math.sin(time * 2.8 + wake.seed) * 0.06 * life,
        time * 0.16 + wake.seed * 0.4,
      );
      wake.mesh.scale.setScalar(radius);
      wake.mesh.material.opacity = Math.min(0.28, fade * wake.contact * (0.28 + lipPower * 0.12));
    }
  }

  return { root, update };
}

function getContactDepth(waterHeight: number, boardHeight: number): number {
  return Math.min(1, Math.max(0, (waterHeight - boardHeight + 0.22) * 1.4));
}

function createPoseEditorLink(): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'game-tool-link';
  link.href = '?view=pose-editor';
  link.textContent = 'Pose Editor';
  link.setAttribute('aria-label', 'Open pose editor');
  link.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });
  link.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.location.assign(link.href);
  });
  return link;
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
