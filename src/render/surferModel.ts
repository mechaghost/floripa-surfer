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

const BOARD_DECK_Y = 0.07;
const FOOT_DECK_SINK = 0.018;

export type SurferModel = {
  root: Group;
  update: (state: SurferState, time: number) => void;
};

export function getSurferRenderHeading(simHeading: number): number {
  return -simHeading;
}

export function getSurferRenderBank(simBank: number): number {
  return -simBank;
}

export function createSurferModel(): SurferModel {
  const root = new Group();
  const trickPivot = new Group();
  const fallback = new Group();
  const assetRig = new Group();
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
  void loadRidingAssets(assetRig, fallback).catch((error: unknown) => {
    console.warn('Surfer GLB assets failed to load; using fallback model.', error);
  });

  function update(state: SurferState, time: number): void {
    const renderBank = getSurferRenderBank(state.bank);
    root.position.set(state.position.x, state.height + 0.26, state.position.z);
    root.rotation.set(state.pitch, getSurferRenderHeading(state.heading), renderBank);

    const bounce = Math.sin(time * 10 + state.speed) * 0.025;
    torso.position.y = 0.82 + bounce;
    leftArm.rotation.z = 0.7 + renderBank * 0.8;
    rightArm.rotation.z = -0.7 + renderBank * 0.8;

    if (state.activeTrick) {
      const progress = state.activeTrick.timer / state.activeTrick.duration;
      trickPivot.rotation.y = progress * Math.PI * 2 * state.activeTrick.spin;
      trickPivot.rotation.z = Math.sin(progress * Math.PI) * 0.65;
    } else {
      trickPivot.rotation.y *= 0.85;
      trickPivot.rotation.z *= 0.82;
    }
  }

  return { root, update };
}

async function loadRidingAssets(assetRig: Group, fallback: Group): Promise<void> {
  const loader = new GLTFLoader();
  const [boardGltf, riderGltf] = await Promise.all([
    loader.loadAsync('/assets/models/surfboard-jeremy.glb'),
    loader.loadAsync('/assets/models/beach-character-quaternius.glb'),
  ]);

  const board = prepareBoard(boardGltf.scene);
  const rider = prepareRider(riderGltf.scene, riderGltf.animations);

  assetRig.add(board, rider);
  fallback.visible = false;
  assetRig.visible = true;
}

function prepareBoard(model: Object3D): Group {
  const wrapper = new Group();
  wrapper.name = 'RuntimeSurfboard';
  normalizeAsset(model, 3.4, 'longest');
  model.rotation.set(-Math.PI / 2, -Math.PI / 2, 0);
  placeAssetOnDeck(model);
  model.position.y = 0.02;
  wrapper.add(model);
  wrapper.rotation.x = -0.05;
  return wrapper;
}

function prepareRider(model: Object3D, animations: AnimationClip[]): Group {
  const wrapper = new Group();
  wrapper.name = 'RuntimeRider';
  normalizeAsset(model, 1.48, 'height');
  model.position.x = -0.03;
  model.position.z = -0.02;
  model.rotation.y = Math.PI;
  model.scale.y *= 0.72;
  model.scale.x *= 1.08;
  model.scale.z *= 1.04;
  wrapper.add(model);
  tintRiderForSurf(model);
  applyAnimationPose(model, animations);
  applySurfPose(model);
  snapFeetToDeck(model, BOARD_DECK_Y);
  return wrapper;
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

function placeAssetOnDeck(model: Object3D): void {
  const box = new Box3().setFromObject(model);
  const center = box.getCenter(new Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;
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

  model.position.y += deckY - FOOT_DECK_SINK - box.min.y;
}

function tintRiderForSurf(model: Object3D): void {
  model.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    const name = child.material instanceof MeshStandardMaterial ? child.material.name.toLowerCase() : '';
    if (name.includes('red')) {
      child.material.color.set('#0c4051');
      child.material.roughness = 0.58;
    }
  });
}

function applyAnimationPose(model: Object3D, animations: AnimationClip[]): void {
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

function applySurfPose(model: Object3D): void {
  const bones = new Map<string, Object3D>();
  model.traverse((child) => bones.set(child.name, child));

  rotateBone(bones, 'Hips', 0.08, 0, -0.08);
  rotateBone(bones, 'Abdomen', -0.16, 0, 0.06);
  rotateBone(bones, 'Torso', -0.08, 0, 0);
  rotateBone(bones, 'Chest', 0.18, 0, 0.06);
}

function rotateBone(bones: Map<string, Object3D>, name: string, x: number, y: number, z: number): void {
  const bone = bones.get(name);
  if (!bone) {
    return;
  }

  bone.rotation.x += x;
  bone.rotation.y += y;
  bone.rotation.z += z;
}

function limb(x: number, y: number, z: number, roll: number, material: MeshStandardMaterial): Mesh {
  const mesh = new Mesh(new CylinderGeometry(0.06, 0.075, 0.74, 10), material);
  mesh.position.set(x, y, z);
  mesh.rotation.z = roll;
  mesh.rotation.x = Math.PI / 2.6;
  mesh.castShadow = true;
  return mesh;
}
