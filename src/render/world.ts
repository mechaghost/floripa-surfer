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

const BOARD_VISUAL_FORWARD_OFFSET = -Math.PI / 2;

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
  camera.position.set(-5, 4.2, 13);
  const lookTarget = new Vector3();
  let chaseHeading: number | null = null;
  let lookHeading: number | null = null;

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
    const board = new Vector3(state.position.x, state.height + 0.38, state.position.z);
    const followHeading = getBoardVisualHeading(state.heading);
    chaseHeading = chaseHeading === null ? followHeading : dampAngle(chaseHeading, followHeading, 12, dt);
    lookHeading = lookHeading === null ? followHeading : dampAngle(lookHeading, followHeading, 14, dt);
    const chaseForward = new Vector3(Math.sin(chaseHeading), 0, -Math.cos(chaseHeading));
    const lookForward = new Vector3(Math.sin(lookHeading), 0, -Math.cos(lookHeading));
    const speedPush = Math.min(1.9, state.speed * 0.065);
    const behind = new Vector3(
      board.x,
      board.y,
      board.z,
    )
      .addScaledVector(chaseForward, -7.4 - speedPush)
      .add(new Vector3(0, 3.1 + state.airtime * 0.25, 0));
    const target = board
      .clone()
      .addScaledVector(lookForward, 8.1 + state.speed * 0.18)
      .add(new Vector3(0, 1.35, 0));

    camera.position.x = damp(camera.position.x, behind.x, 12, dt);
    camera.position.y = damp(camera.position.y, behind.y, 7.8, dt);
    camera.position.z = damp(camera.position.z, behind.z, 12, dt);
    lookTarget.x = damp(lookTarget.x, target.x, 11, dt);
    lookTarget.y = damp(lookTarget.y, target.y, 10, dt);
    lookTarget.z = damp(lookTarget.z, target.z, 11, dt);
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

export function getBoardVisualHeading(simHeading: number): number {
  return simHeading + BOARD_VISUAL_FORWARD_OFFSET;
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
