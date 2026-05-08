import {
  AmbientLight,
  BoxGeometry,
  ConeGeometry,
  DirectionalLight,
  Fog,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { SurferState } from '../game/simulation/surfer';
import { damp } from '../game/simulation/math';

const CAMERA_DISTANCE = 7;
const CAMERA_HEIGHT = 2.9;
const CAMERA_LOOK_AHEAD = 1.6;
const CAMERA_LOOK_HEIGHT = 1.1;
const CAMERA_YAW_DAMPING = 1.45;
const CAMERA_LOOK_YAW_DAMPING = 2.15;

export type World = {
  scene: Scene;
  camera: PerspectiveCamera;
  updateCamera: (state: SurferState, dt: number) => void;
};

export function createWorld(): World {
  const scene = new Scene();
  scene.background = null;
  scene.fog = new Fog('#b8eef5', 28, 155);

  const camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 400);
  const lookTarget = new Vector3();
  let initialized = false;
  let cameraHeading = 0;
  let lookHeading = 0;

  const ambient = new AmbientLight('#d7fbff', 1.4);
  scene.add(ambient);

  const sun = new DirectionalLight('#fff2cc', 3.4);
  sun.position.set(-18, 30, 16);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  const backdrop = createFloripaBackdrop();
  scene.add(backdrop);

  function updateCamera(state: SurferState, dt: number): void {
    const board = new Vector3(state.position.x, state.height + 0.4, state.position.z);
    if (!initialized) {
      cameraHeading = state.heading;
      lookHeading = state.heading;
    } else {
      cameraHeading = dampAngle(cameraHeading, state.heading, CAMERA_YAW_DAMPING, dt);
      lookHeading = dampAngle(lookHeading, state.heading, CAMERA_LOOK_YAW_DAMPING, dt);
    }

    const cameraForward = new Vector3(Math.sin(cameraHeading), 0, -Math.cos(cameraHeading));
    const lookForward = new Vector3(Math.sin(lookHeading), 0, -Math.cos(lookHeading));
    const speedPush = Math.min(2, state.speed * 0.06);
    const distance = CAMERA_DISTANCE + speedPush;
    const desiredPosition = board
      .clone()
      .addScaledVector(cameraForward, -distance)
      .add(new Vector3(0, CAMERA_HEIGHT + state.airtime * 0.2, 0));
    const desiredLook = board
      .clone()
      .addScaledVector(lookForward, CAMERA_LOOK_AHEAD + state.speed * 0.05)
      .add(new Vector3(0, CAMERA_LOOK_HEIGHT, 0));

    if (!initialized) {
      camera.position.copy(desiredPosition);
      lookTarget.copy(desiredLook);
      initialized = true;
    } else {
      camera.position.x = damp(camera.position.x, desiredPosition.x, 10, dt);
      camera.position.y = damp(camera.position.y, desiredPosition.y, 7, dt);
      camera.position.z = damp(camera.position.z, desiredPosition.z, 10, dt);
      lookTarget.x = damp(lookTarget.x, desiredLook.x, 13, dt);
      lookTarget.y = damp(lookTarget.y, desiredLook.y, 8, dt);
      lookTarget.z = damp(lookTarget.z, desiredLook.z, 13, dt);
    }
    camera.lookAt(lookTarget);

    backdrop.position.x = state.position.x;
    backdrop.position.z = state.position.z;
  }

  return { scene, camera, updateCamera };
}

export function dampAngle(current: number, target: number, smoothing: number, dt: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * (1 - Math.exp(-smoothing * dt));
}

function createFloripaBackdrop(): Group {
  const group = new Group();
  const sandMaterial = new MeshBasicMaterial({ color: '#cbd793', transparent: true, opacity: 0.5 });
  const hillMaterial = new MeshBasicMaterial({ color: '#6aa982', transparent: true, opacity: 0.46 });
  const farHillMaterial = new MeshBasicMaterial({ color: '#86b89c', transparent: true, opacity: 0.3 });
  const rockMaterial = new MeshBasicMaterial({ color: '#91947f', transparent: true, opacity: 0.34 });

  const beach = new Mesh(new BoxGeometry(420, 0.8, 8), sandMaterial);
  beach.position.set(0, -0.65, -168);
  beach.receiveShadow = true;
  group.add(beach);

  for (let i = 0; i < 7; i += 1) {
    const farHill = new Mesh(new SphereGeometry(16 + i * 1.1, 18, 8), farHillMaterial);
    farHill.position.set(-150 + i * 48, -1.6, -205 - Math.sin(i * 0.8) * 10);
    farHill.scale.set(1.8, 0.34 + (i % 2) * 0.08, 0.5);
    group.add(farHill);
  }

  for (let i = 0; i < 9; i += 1) {
    const hill = new Mesh(new SphereGeometry(13 + i * 0.8, 18, 8), hillMaterial);
    hill.position.set(-140 + i * 35, -1.45, -184 - Math.sin(i) * 9);
    hill.scale.set(1.55, 0.4 + (i % 3) * 0.07, 0.52);
    hill.receiveShadow = true;
    group.add(hill);
  }

  for (let i = 0; i < 5; i += 1) {
    const rock = new Mesh(new ConeGeometry(2.4 + (i % 2) * 0.6, 5.4, 5), rockMaterial);
    rock.position.set(-130 + i * 64, 0.35, -158 - Math.sin(i * 1.7) * 5);
    rock.rotation.y = i * 0.8;
    rock.castShadow = true;
    group.add(rock);
  }

  return group;
}
