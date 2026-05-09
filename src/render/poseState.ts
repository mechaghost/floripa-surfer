import type { Object3D } from 'three';

export const RIDER_ASSET_URL = '/assets/models/woman-tank-top-quaternius.glb';
export const POSE_STORAGE_KEY = 'floripa-surfer-pose-editor';
export const DEFAULT_POSE_STATE = 'default';

export type SavedPose = {
  asset: string;
  savedAt: string;
  bones: Record<string, {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  }>;
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
