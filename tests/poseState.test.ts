import { afterEach, describe, expect, it, vi } from 'vitest';
import { Object3D } from 'three';
import {
  CANONICAL_POSE_STATES,
  POSE_STORAGE_KEY,
  applySavedPoseToObject,
  applyWeightedPosesToObject,
  getPoseStateOptions,
  loadPoseLibrary,
  normalizePoseStateName,
  savePoseLibrary,
  type PoseLibrary,
  type SavedPose,
} from '../src/render/poseState';
import { isPoseIkTargetDependent } from '../src/render/poseEditor';

describe('pose state', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies saved bone transforms by name to a loaded rider object', () => {
    const rider = new Object3D();
    const hips = new Object3D();
    const torso = new Object3D();
    hips.name = 'Hips';
    torso.name = 'Torso';
    rider.add(hips, torso);

    const pose: SavedPose = {
      asset: '/assets/models/woman-tank-top-quaternius.glb',
      savedAt: '2026-05-08T00:00:00.000Z',
      bones: {
        Hips: {
          position: [0.1, 0.2, 0.3],
          rotation: [0.4, 0.5, 0.6],
          scale: [1.1, 1.2, 1.3],
        },
      },
      ikTargets: {},
    };

    expect(applySavedPoseToObject(pose, rider)).toBe(true);
    expect(hips.position.toArray()).toEqual([0.1, 0.2, 0.3]);
    expect(hips.rotation.toArray().slice(0, 3)).toEqual([0.4, 0.5, 0.6]);
    expect(hips.scale.toArray()).toEqual([1.1, 1.2, 1.3]);
    expect(torso.position.toArray()).toEqual([0, 0, 0]);
  });

  it('blends saved pose transforms with quaternion-safe rotation', () => {
    const rider = new Object3D();
    const hips = new Object3D();
    hips.name = 'Hips';
    rider.add(hips);

    const neutral = createSavedPose('neutral', {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    });
    const target = createSavedPose('target', {
      position: [2, 4, 6],
      rotation: [0, 0, Math.PI],
      scale: [2, 3, 4],
    });

    expect(applyWeightedPosesToObject([
      { pose: neutral, weight: 1 },
      { pose: target, weight: 1 },
    ], rider)).toBe(true);
    expect(hips.position.toArray()).toEqual([1, 2, 3]);
    expect(hips.scale.toArray()).toEqual([1.5, 2, 2.5]);
    expect(Math.abs(hips.rotation.z)).toBeCloseTo(Math.PI / 2);
  });

  it('leaves objects untouched when all blend weights are zero', () => {
    const rider = new Object3D();
    const hips = new Object3D();
    hips.name = 'Hips';
    hips.position.set(3, 2, 1);
    rider.add(hips);

    const pose = createSavedPose('target', {
      position: [8, 8, 8],
      rotation: [1, 1, 1],
      scale: [2, 2, 2],
    });

    expect(applyWeightedPosesToObject([{ pose, weight: 0 }], rider)).toBe(false);
    expect(hips.position.toArray()).toEqual([3, 2, 1]);
  });

  it('normalizes state names and exposes canonical pose states first', () => {
    const library: PoseLibrary = {
      asset: '/assets/models/woman-tank-top-quaternius.glb',
      updatedAt: '2026-05-08T00:00:00.000Z',
      activeState: 'default',
      states: { 'custom-pose': createSavedPose('custom-pose') },
    };

    expect(normalizePoseStateName(' Left Lean! ')).toBe('left-lean');
    expect(normalizePoseStateName('')).toBe('default');
    expect(getPoseStateOptions(library, 'air-jump').slice(0, CANONICAL_POSE_STATES.length)).toEqual([
      ...CANONICAL_POSE_STATES,
    ]);
    expect(getPoseStateOptions(library, 'air-jump')).toContain('custom-pose');
  });

  it('falls back to bundled poses for invalid storage and migrates legacy pose JSON', () => {
    const storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
    storage.setItem(POSE_STORAGE_KEY, '{nope');

    expect(loadPoseLibrary().states.default).toBeDefined();
    expect(loadPoseLibrary().states['idle-1']).toBeDefined();

    const legacyPose = createSavedPose('legacy');
    storage.setItem(POSE_STORAGE_KEY, JSON.stringify(legacyPose));

    expect(loadPoseLibrary().states.default.bones.Hips.position).toEqual([0, 0, 0]);
  });

  it('swallows storage write failures so export/copy can still work', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    });

    expect(() => savePoseLibrary({
      asset: '/assets/models/woman-tank-top-quaternius.glb',
      updatedAt: '2026-05-08T00:00:00.000Z',
      activeState: 'default',
      states: {},
    })).not.toThrow();
  });

  it('detects IK targets that should follow a moved parent target', () => {
    const torso = new Object3D();
    const neck = new Object3D();
    const head = new Object3D();
    const hips = new Object3D();
    const leg = new Object3D();
    torso.add(neck);
    neck.add(head);
    hips.add(leg);

    expect(isPoseIkTargetDependent(torso, head)).toBe(true);
    expect(isPoseIkTargetDependent(torso, leg)).toBe(false);
  });
});

function createSavedPose(name: string, transform = {
  position: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  scale: [1, 1, 1] as [number, number, number],
}): SavedPose {
  return {
    asset: '/assets/models/woman-tank-top-quaternius.glb',
    savedAt: `2026-05-08T00:00:00.000Z-${name}`,
    bones: {
      Hips: transform,
    },
    ikTargets: {},
  };
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
}
