import { describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import { applySavedPoseToObject, type SavedPose } from '../src/render/poseState';

describe('pose state', () => {
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
});
