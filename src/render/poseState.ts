import { Euler, Quaternion, Vector3, type Object3D } from 'three';

export const RIDER_ASSET_URL = '/assets/models/woman-tank-top-quaternius.glb';
export const POSE_STORAGE_KEY = 'floripa-surfer-pose-editor';
export const DEFAULT_POSE_STATE = 'default';
export const IDLE_POSE_STATES = ['idle-1', 'idle-2', 'idle-3', 'idle-4'] as const;
export const SURF_POSE_STATES = ['left-lean', 'right-lean', 'start-jump', 'air-jump'] as const;
export const CANONICAL_POSE_STATES = [
  DEFAULT_POSE_STATE,
  ...IDLE_POSE_STATES,
  ...SURF_POSE_STATES,
] as const;

export type PoseStateName = (typeof CANONICAL_POSE_STATES)[number];

export type SavedBoneTransform = {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
};

export type SavedPose = {
  asset: string;
  savedAt: string;
  bones: Record<string, SavedBoneTransform>;
  ikTargets: Record<string, [number, number, number]>;
};

export type PoseLibrary = {
  asset: string;
  updatedAt: string;
  activeState: string;
  states: Record<string, SavedPose>;
};

export function loadPoseLibrary(): PoseLibrary {
  const emptyLibrary = createEmptyPoseLibrary();
  const saved = readPoseStorage();
  if (!saved) {
    return emptyLibrary;
  }

  try {
    const parsed = JSON.parse(saved) as Partial<PoseLibrary> & Partial<SavedPose>;
    if (parsed.states && typeof parsed.states === 'object') {
      return {
        asset: parsed.asset ?? RIDER_ASSET_URL,
        updatedAt: parsed.updatedAt ?? new Date().toISOString(),
        activeState: normalizePoseStateName(parsed.activeState ?? DEFAULT_POSE_STATE),
        states: parsed.states,
      };
    }

    if (parsed.bones && typeof parsed.bones === 'object') {
      return {
        ...emptyLibrary,
        states: {
          [DEFAULT_POSE_STATE]: parsed as SavedPose,
        },
      };
    }
  } catch {
    return emptyLibrary;
  }

  return emptyLibrary;
}

export function savePoseLibrary(library: PoseLibrary): void {
  try {
    localStorage.setItem(POSE_STORAGE_KEY, JSON.stringify(library));
  } catch {
    // The editor can still export/copy JSON when storage is unavailable.
  }
}

export function loadStoredPoseState(stateName = DEFAULT_POSE_STATE): SavedPose | null {
  const library = loadPoseLibrary();
  return library.states[normalizePoseStateName(stateName)] ?? null;
}

export function getPoseStateOptions(library: PoseLibrary, activeState: string): string[] {
  const names = new Set([
    ...CANONICAL_POSE_STATES,
    ...Object.keys(library.states),
    normalizePoseStateName(activeState),
  ]);
  return Array.from(names).sort((a, b) => {
    const canonicalA = CANONICAL_POSE_STATES.indexOf(a as PoseStateName);
    const canonicalB = CANONICAL_POSE_STATES.indexOf(b as PoseStateName);
    if (canonicalA >= 0 || canonicalB >= 0) {
      if (canonicalA < 0) {
        return 1;
      }
      if (canonicalB < 0) {
        return -1;
      }
      return canonicalA - canonicalB;
    }

    return a.localeCompare(b);
  });
}

export function applySavedPoseToObject(pose: SavedPose, root: Object3D): boolean {
  let applied = false;
  root.traverse((child) => {
    const saved = pose.bones[child.name];
    if (!saved) {
      return;
    }

    child.position.set(saved.position[0], saved.position[1], saved.position[2]);
    child.rotation.set(saved.rotation[0], saved.rotation[1], saved.rotation[2]);
    child.scale.set(saved.scale[0], saved.scale[1], saved.scale[2]);
    child.updateMatrixWorld(true);
    applied = true;
  });
  return applied;
}

export type WeightedSavedPose = {
  pose: SavedPose;
  weight: number;
};

export function applyWeightedPosesToObject(poses: WeightedSavedPose[], root: Object3D): boolean {
  const activePoses = poses.filter(({ weight }) => weight > 0.0001);
  if (activePoses.length === 0) {
    return false;
  }

  const position = new Vector3();
  const scale = new Vector3();
  const rotation = new Quaternion();
  const nextRotation = new Quaternion();
  const euler = new Euler();
  let applied = false;

  root.traverse((child) => {
    let totalWeight = 0;
    let hasRotation = false;
    position.set(0, 0, 0);
    scale.set(0, 0, 0);
    rotation.identity();

    for (const { pose, weight } of activePoses) {
      const saved = pose.bones[child.name];
      if (!saved) {
        continue;
      }

      totalWeight += weight;
      position.x += saved.position[0] * weight;
      position.y += saved.position[1] * weight;
      position.z += saved.position[2] * weight;
      scale.x += saved.scale[0] * weight;
      scale.y += saved.scale[1] * weight;
      scale.z += saved.scale[2] * weight;

      euler.set(saved.rotation[0], saved.rotation[1], saved.rotation[2]);
      nextRotation.setFromEuler(euler);
      if (!hasRotation) {
        rotation.copy(nextRotation);
        hasRotation = true;
      } else {
        rotation.slerp(nextRotation, weight / totalWeight);
      }
    }

    if (totalWeight <= 0) {
      return;
    }

    position.multiplyScalar(1 / totalWeight);
    scale.multiplyScalar(1 / totalWeight);
    child.position.copy(position);
    child.quaternion.copy(rotation);
    child.scale.copy(scale);
    child.updateMatrixWorld(true);
    applied = true;
  });

  return applied;
}

export function normalizePoseStateName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || DEFAULT_POSE_STATE;
}

function createEmptyPoseLibrary(): PoseLibrary {
  return {
    asset: RIDER_ASSET_URL,
    updatedAt: new Date().toISOString(),
    activeState: DEFAULT_POSE_STATE,
    states: {},
  };
}

function readPoseStorage(): string | null {
  try {
    return localStorage.getItem(POSE_STORAGE_KEY);
  } catch {
    return null;
  }
}
