import {
  AnimationClip,
  AnimationMixer,
  Box3,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SkinnedMesh,
  SphereGeometry,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { SurferState } from '../game/simulation/surfer';
import { sampleWave } from '../game/simulation/waves';
import {
  DEFAULT_POSE_STATE,
  IDLE_POSE_STATES,
  RIDER_ASSET_URL,
  applySavedPoseToObject,
  applyWeightedPosesToObject,
  loadPoseLibrary,
  type PoseLibrary,
  type SavedPose,
  type WeightedSavedPose,
} from './poseState';

const BOARD_DECK_TOP_PERCENTILE = 0.92;
const BOARD_HULL_BOTTOM_PERCENTILE = 0.15;
const BOARD_HULL_CLEARANCE = 0.02;
const BOARD_SURFACE_LENGTH = 2.9;
const BOARD_SURFACE_WIDTH = 0.82;
const BOARD_FIN_PROTRUSION_SCALE = 0.32;
const MAX_VISUAL_PITCH = 0.34;
const MAX_VISUAL_BANK = 0.82;
const FOOT_DECK_CLEARANCE = 0.018;

export type SurferModel = {
  root: Group;
  update: (state: SurferState, time: number) => void;
};

type RiderPoseTarget = {
  name: string;
  weight: number;
};

type PreparedRider = {
  wrapper: Group;
  poseRoot: Object3D;
  poseLibrary: PoseLibrary;
};

type RiderPoseController = {
  poseRoot: Object3D;
  poses: Map<string, SavedPose>;
  weights: Map<string, number>;
};

export function getSurferRenderHeading(simHeading: number): number {
  return -simHeading;
}

export function getSurferRenderBank(simBank: number): number {
  return -simBank;
}

export function getSurferPoseTargets(state: SurferState, time: number): RiderPoseTarget[] {
  const targets: RiderPoseTarget[] = [{ name: DEFAULT_POSE_STATE, weight: 1 }];
  const leanLeft = clamp((Math.max(-state.turn, -state.bank * 1.2) - 0.08) / 0.95, 0, 1);
  const leanRight = clamp((Math.max(state.turn, state.bank * 1.2) - 0.08) / 0.95, 0, 1);
  const leanStrength = Math.max(leanLeft, leanRight);
  const isAirborne = state.airtime > 0 || Math.abs(state.verticalVelocity) > 0.02;
  const jumpProgress = state.activeTrick?.name === 'Jump'
    ? clamp(state.activeTrick.timer / state.activeTrick.duration, 0, 1)
    : null;
  const startJump = jumpProgress === null ? 0 : 1 - smoothstep(0.24, 0.62, jumpProgress);
  const airJump = jumpProgress === null
    ? (isAirborne ? clamp(0.35 + Math.abs(state.verticalVelocity) * 0.12, 0, 0.92) : 0)
    : Math.max(isAirborne ? 0.42 : 0, smoothstep(0.2, 0.58, jumpProgress));
  const idleStrength = (1 - leanStrength) * (isAirborne ? 0 : 0.35);

  if (idleStrength > 0.001) {
    const idleCycle = wrapPositive(time / 3.6, IDLE_POSE_STATES.length);
    const idleIndex = Math.floor(idleCycle);
    const nextIdleIndex = (idleIndex + 1) % IDLE_POSE_STATES.length;
    const blend = smoothstep(0.18, 0.82, idleCycle - idleIndex);
    targets.push({ name: IDLE_POSE_STATES[idleIndex], weight: idleStrength * (1 - blend) });
    targets.push({ name: IDLE_POSE_STATES[nextIdleIndex], weight: idleStrength * blend });
  }

  if (leanLeft > 0.001) {
    targets.push({ name: 'left-lean', weight: leanLeft * 0.9 });
  }
  if (leanRight > 0.001) {
    targets.push({ name: 'right-lean', weight: leanRight * 0.9 });
  }
  if (startJump > 0.001) {
    targets.push({ name: 'start-jump', weight: startJump * 1.15 });
  }
  if (airJump > 0.001) {
    targets.push({ name: 'air-jump', weight: airJump });
  }

  return targets;
}

export function createSurferModel(): SurferModel {
  const root = new Group();
  const trickPivot = new Group();
  const fallback = new Group();
  const assetRig = new Group();
  let visualPitch = 0;
  let visualBank = 0;
  let previousUpdateTime: number | null = null;
  let riderPoseController: RiderPoseController | null = null;
  root.add(trickPivot);
  trickPivot.add(fallback, assetRig);
  assetRig.visible = false;

  const boardMaterial = new MeshStandardMaterial({
    color: new Color('#ffef5c'),
    roughness: 0.4,
    metalness: 0.05,
  });
  const railMaterial = new MeshStandardMaterial({ color: '#fe5f55', roughness: 0.45 });
  const skinMaterial = new MeshStandardMaterial({ color: '#b86f4f', roughness: 0.55 });
  const suitMaterial = new MeshStandardMaterial({ color: '#14213d', roughness: 0.5 });

  const board = new Mesh(new CapsuleGeometry(0.38, 2.8, 8, 20), boardMaterial);
  board.rotation.x = Math.PI / 2;
  board.scale.set(0.78, 0.16, 1);
  board.castShadow = true;
  fallback.add(board);

  const stripe = new Mesh(new BoxGeometry(0.08, 0.06, 2.45), railMaterial);
  stripe.position.y = 0.11;
  stripe.castShadow = true;
  fallback.add(stripe);

  const torso = new Mesh(new CapsuleGeometry(0.28, 0.55, 6, 12), suitMaterial);
  torso.position.set(0, 0.82, -0.08);
  torso.rotation.x = -0.15;
  torso.castShadow = true;
  fallback.add(torso);

  const head = new Mesh(new SphereGeometry(0.19, 16, 10), skinMaterial);
  head.position.set(0, 1.33, -0.16);
  head.castShadow = true;
  fallback.add(head);

  const leftArm = limb(-0.38, 0.95, -0.12, 0.72, skinMaterial);
  const rightArm = limb(0.38, 0.95, -0.12, -0.72, skinMaterial);
  const leftLeg = limb(-0.24, 0.42, 0.32, 0.26, skinMaterial);
  const rightLeg = limb(0.24, 0.42, -0.42, -0.26, skinMaterial);
  fallback.add(leftArm, rightArm, leftLeg, rightLeg);
  void loadRidingAssets(assetRig, fallback).then((controller) => {
    riderPoseController = controller;
  }).catch((error: unknown) => {
    console.warn('Surfer GLB assets failed to load; using fallback model.', error);
  });

  function update(state: SurferState, time: number): void {
    const dt = previousUpdateTime === null ? 1 / 60 : Math.min(1 / 20, Math.max(0, time - previousUpdateTime));
    previousUpdateTime = time;

    const renderBank = getSurferRenderBank(state.bank);
    const trim = getOrganicBoardTrim(state, time);
    const targetPitch = clamp(state.pitch * 0.45 + trim.pitch, -MAX_VISUAL_PITCH, MAX_VISUAL_PITCH);
    const targetBank = clamp(renderBank + trim.bank, -MAX_VISUAL_BANK, MAX_VISUAL_BANK);
    visualPitch = dampValue(visualPitch, targetPitch, 7.5, dt);
    visualBank = dampValue(visualBank, targetBank, 7.5, dt);

    root.position.set(state.position.x, state.height + 0.26, state.position.z);
    root.rotation.set(visualPitch, getSurferRenderHeading(state.heading), visualBank);

    const bounce = Math.sin(time * 10 + state.speed) * 0.025;
    torso.position.y = 0.82 + bounce;
    leftArm.rotation.z = 0.7 + visualBank * 0.8;
    rightArm.rotation.z = -0.7 + visualBank * 0.8;
    if (riderPoseController) {
      updateRiderPose(riderPoseController, state, time, dt);
    }

    if (state.activeTrick) {
      const progress = state.activeTrick.timer / state.activeTrick.duration;
      trickPivot.rotation.y = progress * Math.PI * 2 * state.activeTrick.spin;
      trickPivot.rotation.z = Math.sin(progress * Math.PI) * 0.65 * Math.abs(state.activeTrick.spin);
    } else {
      trickPivot.rotation.y *= 0.85;
      trickPivot.rotation.z *= 0.82;
    }
  }

  return { root, update };
}

function getOrganicBoardTrim(state: SurferState, time: number): { pitch: number; bank: number } {
  const forwardX = Math.sin(state.heading);
  const forwardZ = -Math.cos(state.heading);
  const rightX = Math.cos(state.heading);
  const rightZ = Math.sin(state.heading);
  const halfLength = BOARD_SURFACE_LENGTH * 0.5;
  const halfWidth = BOARD_SURFACE_WIDTH * 0.5;

  const nose = sampleWave(
    state.position.x + forwardX * halfLength,
    state.position.z + forwardZ * halfLength,
    time,
  );
  const tail = sampleWave(
    state.position.x - forwardX * halfLength,
    state.position.z - forwardZ * halfLength,
    time,
  );
  const rightRail = sampleWave(
    state.position.x + rightX * halfWidth,
    state.position.z + rightZ * halfWidth,
    time,
  );
  const leftRail = sampleWave(
    state.position.x - rightX * halfWidth,
    state.position.z - rightZ * halfWidth,
    time,
  );

  const speedFactor = clamp((state.speed - 4.5) / 11, 0, 1);
  const waterContact = state.airtime > 0 || state.verticalVelocity !== 0 ? 0.35 : 1;
  const surfacePitch = clamp(Math.atan2(nose.height - tail.height, BOARD_SURFACE_LENGTH) * 0.62, -0.13, 0.15);
  const surfaceBank = clamp(Math.atan2(rightRail.height - leftRail.height, BOARD_SURFACE_WIDTH) * 0.24, -0.08, 0.08);
  const livingPitch =
    (Math.sin(time * 2.15 + state.position.z * 0.08) * 0.028 +
      Math.sin(time * 4.4 + state.position.x * 0.11) * 0.012) *
    speedFactor *
    waterContact;
  const livingBank =
    (Math.sin(time * 1.65 + state.position.x * 0.1) * 0.04 +
      Math.sin(time * 3.25 + state.position.z * 0.06) * 0.015) *
    speedFactor *
    waterContact;

  return {
    pitch: surfacePitch * waterContact + livingPitch,
    bank: surfaceBank * waterContact + livingBank,
  };
}

function createRiderPoseController(rider: PreparedRider): RiderPoseController | null {
  const poses = new Map(Object.entries(rider.poseLibrary.states));
  if (poses.size === 0) {
    return null;
  }
  if (!poses.has(DEFAULT_POSE_STATE)) {
    poses.set(DEFAULT_POSE_STATE, captureObjectPose(rider.poseRoot));
  }

  return {
    poseRoot: rider.poseRoot,
    poses,
    weights: new Map(),
  };
}

function updateRiderPose(controller: RiderPoseController, state: SurferState, time: number, dt: number): void {
  const targetWeights = new Map(getSurferPoseTargets(state, time).map(({ name, weight }) => [name, weight]));
  const poseNames = new Set([...controller.poses.keys(), ...targetWeights.keys()]);
  for (const name of poseNames) {
    const current = controller.weights.get(name) ?? 0;
    const target = targetWeights.get(name) ?? 0;
    const next = dampValue(current, target, target > current ? 7.5 : 5.5, dt);
    if (next < 0.0001 && target <= 0) {
      controller.weights.delete(name);
    } else {
      controller.weights.set(name, next);
    }
  }

  const weightedPoses: WeightedSavedPose[] = [];
  for (const [name, weight] of controller.weights) {
    const pose = controller.poses.get(name);
    if (pose && weight > 0.0001) {
      weightedPoses.push({ pose, weight });
    }
  }

  applyWeightedPosesToObject(weightedPoses, controller.poseRoot);
}

function captureObjectPose(root: Object3D): SavedPose {
  const pose: SavedPose = {
    asset: RIDER_ASSET_URL,
    savedAt: new Date().toISOString(),
    bones: {},
    ikTargets: {},
  };

  root.traverse((child) => {
    if (!child.name) {
      return;
    }

    pose.bones[child.name] = {
      position: [child.position.x, child.position.y, child.position.z],
      rotation: [child.rotation.x, child.rotation.y, child.rotation.z],
      scale: [child.scale.x, child.scale.y, child.scale.z],
    };
  });

  return pose;
}

function dampValue(current: number, target: number, smoothing: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-smoothing * dt));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function wrapPositive(value: number, length: number): number {
  return ((value % length) + length) % length;
}

async function loadRidingAssets(assetRig: Group, fallback: Group): Promise<RiderPoseController | null> {
  const loader = new GLTFLoader();
  const [boardGltf, riderGltf] = await Promise.all([
    loader.loadAsync('/assets/models/surfboard-jeremy.glb'),
    loader.loadAsync(RIDER_ASSET_URL),
  ]);

  const board = prepareBoard(boardGltf.scene);
  const deckY = estimateBoardDeckTop(board);
  const rider = prepareRider(riderGltf.scene, riderGltf.animations, deckY);

  assetRig.add(board, rider.wrapper);
  fallback.visible = false;
  assetRig.visible = true;
  return createRiderPoseController(rider);
}

function prepareBoard(model: Object3D): Group {
  const wrapper = new Group();
  wrapper.name = 'RuntimeSurfboard';
  normalizeAsset(model, 3.4, 'longest');
  model.rotation.set(-Math.PI / 2, -Math.PI / 2, 0);
  shortenBoardFins(model);
  placeBoardOnHull(model);
  model.position.y += BOARD_HULL_CLEARANCE;
  wrapper.add(model);
  wrapper.rotation.x = -0.05;
  return wrapper;
}

function prepareRider(model: Object3D, animations: AnimationClip[], deckY: number): PreparedRider {
  const wrapper = new Group();
  wrapper.name = 'RuntimeRider';
  normalizeAsset(model, 1.48, 'height');
  model.position.x = -0.03;
  model.position.z = -0.02;
  model.rotation.y = Math.PI;
  model.scale.x *= 1.02;
  model.scale.z *= 1.02;
  wrapper.add(model);
  tintRiderForSurf(model);
  applyAnimationPose(model, animations);
  snapFeetToDeck(model, deckY);
  const poseLibrary = loadPoseLibrary();
  const defaultPose = poseLibrary.states[DEFAULT_POSE_STATE];
  if (defaultPose) {
    applySavedPoseToObject(defaultPose, model);
  }
  return { wrapper, poseRoot: model, poseLibrary };
}

function normalizeAsset(model: Object3D, targetSize: number, axis: 'height' | 'longest'): void {
  setRuntimeFlags(model);
  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const sourceSize = axis === 'height' ? size.y : Math.max(size.x, size.y, size.z);

  if (sourceSize <= 0) {
    return;
  }

  model.position.sub(center);
  model.scale.multiplyScalar(targetSize / sourceSize);

  const fittedBox = new Box3().setFromObject(model);
  const fittedCenter = fittedBox.getCenter(new Vector3());
  model.position.x -= fittedCenter.x;
  model.position.z -= fittedCenter.z;
  model.position.y -= fittedBox.min.y;
}

function setRuntimeFlags(model: Object3D): void {
  model.traverse((child) => {
    if (child instanceof Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

function placeBoardOnHull(model: Object3D): void {
  const box = new Box3().setFromObject(model);
  const center = box.getCenter(new Vector3());
  const hullBottomY = estimateBoardHullBottom(model, box.min.y);
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= hullBottomY;
}

function shortenBoardFins(model: Object3D): void {
  const box = new Box3().setFromObject(model);
  const hullBottomY = estimateBoardHullBottom(model, box.min.y);
  const vertex = new Vector3();
  const worldVertex = new Vector3();

  model.updateMatrixWorld(true);
  model.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    const positions = child.geometry.getAttribute('position');
    if (!positions) {
      return;
    }

    let changed = false;
    for (let index = 0; index < positions.count; index += 1) {
      vertex.fromBufferAttribute(positions, index);
      worldVertex.copy(vertex);
      child.localToWorld(worldVertex);

      if (worldVertex.y >= hullBottomY) {
        continue;
      }

      worldVertex.y = hullBottomY + (worldVertex.y - hullBottomY) * BOARD_FIN_PROTRUSION_SCALE;
      child.worldToLocal(worldVertex);
      positions.setXYZ(index, worldVertex.x, worldVertex.y, worldVertex.z);
      changed = true;
    }

    if (changed) {
      positions.needsUpdate = true;
      child.geometry.computeVertexNormals();
      child.geometry.computeBoundingBox();
      child.geometry.computeBoundingSphere();
    }
  });
}

function estimateBoardHullBottom(model: Object3D, fallbackY: number): number {
  const vertex = new Vector3();
  const yValues: number[] = [];

  model.updateMatrixWorld(true);
  model.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    const positions = child.geometry.getAttribute('position');
    if (!positions) {
      return;
    }

    for (let index = 0; index < positions.count; index += 1) {
      vertex.fromBufferAttribute(positions, index).applyMatrix4(child.matrixWorld);
      yValues.push(vertex.y);
    }
  });

  if (yValues.length === 0) {
    return fallbackY;
  }

  yValues.sort((a, b) => a - b);
  const hullIndex = Math.min(
    yValues.length - 1,
    Math.floor((yValues.length - 1) * BOARD_HULL_BOTTOM_PERCENTILE),
  );
  return yValues[hullIndex];
}

function estimateBoardDeckTop(model: Object3D): number {
  const vertex = new Vector3();
  const yValues: number[] = [];

  model.updateMatrixWorld(true);
  model.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    const positions = child.geometry.getAttribute('position');
    if (!positions) {
      return;
    }

    for (let index = 0; index < positions.count; index += 1) {
      vertex.fromBufferAttribute(positions, index).applyMatrix4(child.matrixWorld);
      yValues.push(vertex.y);
    }
  });

  if (yValues.length === 0) {
    return 0;
  }

  yValues.sort((a, b) => a - b);
  const deckIndex = Math.min(
    yValues.length - 1,
    Math.floor((yValues.length - 1) * BOARD_DECK_TOP_PERCENTILE),
  );
  return yValues[deckIndex];
}

function snapFeetToDeck(model: Object3D, deckY: number): void {
  model.updateMatrixWorld(true);
  const box = new Box3();
  let hasFootBounds = false;

  model.traverse((child) => {
    if (child instanceof SkinnedMesh && child.name.includes('Feet')) {
      box.expandByObject(child);
      hasFootBounds = true;
    }
  });

  if (!hasFootBounds) {
    box.setFromObject(model);
  }

  model.position.y += deckY + FOOT_DECK_CLEARANCE - box.min.y;
}

function tintRiderForSurf(model: Object3D): void {
  model.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!(material instanceof MeshStandardMaterial)) {
        continue;
      }

      const name = material.name.toLowerCase();
      material.roughness = 0.62;
      material.metalness = 0.04;

      if (name.includes('shirt')) {
        material.color.set('#ee7651');
      } else if (name.includes('pants')) {
        material.color.set('#123f4d');
      } else if (name.includes('skin')) {
        material.color.set('#a46a49');
      } else if (name.includes('hair')) {
        material.color.set('#23150f');
      } else if (name.includes('shoes')) {
        material.color.set('#5b3728');
      } else if (name.includes('red')) {
        material.color.set('#0c4051');
      }
    }
  });
}

function applyAnimationPose(model: Object3D, animations: AnimationClip[]): void {
  if (animations.some((animation) => animation.name.startsWith('HumanArmature|Female_'))) {
    return;
  }

  const clip =
    AnimationClip.findByName(animations, 'CharacterArmature|Idle_Neutral')
    ?? AnimationClip.findByName(animations, 'CharacterArmature|Run_Left');

  if (!clip) {
    return;
  }

  const mixer = new AnimationMixer(model);
  const action = mixer.clipAction(clip);
  action.play();
  mixer.setTime(Math.min(0.32, clip.duration * 0.45));
}

function limb(x: number, y: number, z: number, roll: number, material: MeshStandardMaterial): Mesh {
  const mesh = new Mesh(new CylinderGeometry(0.06, 0.075, 0.74, 10), material);
  mesh.position.set(x, y, z);
  mesh.rotation.z = roll;
  mesh.rotation.x = Math.PI / 2.6;
  mesh.castShadow = true;
  return mesh;
}
