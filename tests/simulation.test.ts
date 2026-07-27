import { describe, expect, it } from 'vitest';
import { createInitialSurferState, updateSurfer } from '../src/game/simulation/surfer';
import { createInputState } from '../src/game/input/inputState';
import {
  BREAKER_TRAVEL,
  PEEL_DIRECTION,
  getPocketWorldPosition,
  sampleFoamField,
  sampleSurface,
  sampleWave,
  sampleWaveSet,
  type WaveSample,
} from '../src/game/simulation/waves';
import { dampAngle } from '../src/render/world';
import {
  getBoardWaterProbePose,
  getOrganicBoardTrim,
  getSurferPoseTargets,
  getSurferRenderBank,
  getSurferRenderHeading,
  getSurferVisualHeight,
} from '../src/render/surferModel';
import { getBoardWaterContact, isBoardAirborne } from '../src/render/waterContact';
import { getBoardWaterDeformation, getWakeStampDeformation } from '../src/render/ocean';

const WAVE_DIR_X = -BREAKER_TRAVEL.x;
const WAVE_DIR_Z = -BREAKER_TRAVEL.z;

function makeWave(overrides: Partial<WaveSample> = {}): WaveSample {
  return {
    height: 0,
    slopeX: 0,
    slopeZ: 0,
    lipPower: 0,
    facePower: 0,
    curl: 0,
    whitewater: 0,
    barrelDepth: 0,
    peel: 0,
    ...overrides,
  };
}

// A world point offset from the crest above the current pocket: faceOffset
// moves along the wave travel axis (negative = down the face, shoreward of the
// crest), peelOffset moves along the crest (positive = deeper into the
// broken/barrel side). getPocketWorldPosition returns the porch on the face
// (s = -3.2), so re-anchor to the crest first.
const POCKET_PORCH_OFFSET = 3.2;

function pointNearPocket(time: number, faceOffset: number, peelOffset: number): { x: number; z: number } {
  const pocket = getPocketWorldPosition(time, 0, 0);
  const anchored = faceOffset + POCKET_PORCH_OFFSET;
  return {
    x: pocket.x + WAVE_DIR_X * anchored - PEEL_DIRECTION.x * peelOffset,
    z: pocket.z + WAVE_DIR_Z * anchored - PEEL_DIRECTION.z * peelOffset,
  };
}

describe('surfer simulation', () => {
  it('builds speed and stoke when pumping down the wave', () => {
    const state = createInitialSurferState();
    const input = createInputState();
    input.forward = 1;

    const wave = makeWave({ height: 1.2, facePower: 0.8, lipPower: 0.3 });
    const next = updateSurfer(state, input, wave, 0.5);

    expect(next.speed).toBeGreaterThan(state.speed);
    expect(next.stoke).toBeGreaterThan(state.stoke);
  });

  it('banks hard when carving left and preserves arcade control', () => {
    const state = createInitialSurferState();
    const input = createInputState();
    input.left = 1;

    const wave = makeWave({ facePower: 0.6 });
    const next = updateSurfer(state, input, wave, 0.25);

    expect(next.turn).toBeLessThan(0);
    expect(next.bank).toBeLessThan(0);
    expect(next.speed).toBeGreaterThan(0);
  });

  it('banks hard when carving right and preserves arcade control', () => {
    const state = createInitialSurferState();
    const input = createInputState();
    input.right = 1;

    const wave = makeWave({ facePower: 0.6 });
    const next = updateSurfer(state, input, wave, 0.25);

    expect(next.turn).toBeGreaterThan(0);
    expect(next.bank).toBeGreaterThan(0);
    expect(next.speed).toBeGreaterThan(0);
  });

  it('starts a jump action from the action input', () => {
    const state = createInitialSurferState();
    const input = createInputState();
    input.trick = true;
    input.trickUp = true;

    const flatWave = makeWave({ lipPower: 0.1, facePower: 0.2 });
    const jumped = updateSurfer(state, input, flatWave, 0.16);

    expect(jumped.activeTrick?.name).toBe('Jump');
    expect(jumped.airtime).toBeGreaterThan(0);
    expect(jumped.verticalVelocity).toBeGreaterThan(0);
  });

  it('keeps a jump vertical instead of pitching the board up', () => {
    const state = createInitialSurferState();
    const input = createInputState();
    input.trick = true;

    const flatWave = makeWave({ lipPower: 0.1, facePower: 0.2 });
    const jumped = updateSurfer(state, input, flatWave, 0.16);
    const airborne = updateSurfer(jumped, createInputState(), flatWave, 0.16);

    expect(airborne.height).toBeGreaterThan(state.height);
    expect(airborne.pitch).toBeCloseTo(0);
  });

  it('keeps jump descent from becoming too steep', () => {
    let state = createInitialSurferState();
    const input = createInputState();
    input.trick = true;
    const flatWave = makeWave({ lipPower: 0.1, facePower: 0.2 });

    state = updateSurfer(state, input, flatWave, 1 / 30);
    input.trick = false;
    let fastestDrop = 0;
    for (let frame = 0; frame < 45; frame += 1) {
      state = updateSurfer(state, input, flatWave, 1 / 30);
      fastestDrop = Math.min(fastestDrop, state.verticalVelocity);
    }

    expect(fastestDrop).toBeGreaterThanOrEqual(-2.85);
  });

  it('keeps the jump height on a steady arc until landing', () => {
    let state = createInitialSurferState();
    const input = createInputState();
    input.trick = true;
    const flatWave = makeWave({ lipPower: 0.1, facePower: 0.2 });

    state = updateSurfer(state, input, flatWave, 1 / 30);
    input.trick = false;
    let largestFrameDrop = 0;
    let canDoubleJumpInAir = false;

    for (let frame = 0; frame < 90; frame += 1) {
      const previousHeight = state.height;
      state = updateSurfer(state, input, flatWave, 1 / 30);
      largestFrameDrop = Math.min(largestFrameDrop, state.height - previousHeight);

      const jumpAgain = createInputState();
      jumpAgain.trick = true;
      const attempted = updateSurfer(state, jumpAgain, flatWave, 1 / 30);
      if (state.height > flatWave.height + 0.05 && !state.activeTrick && attempted.activeTrick?.name === 'Jump') {
        canDoubleJumpInAir = true;
      }
    }

    expect(largestFrameDrop).toBeGreaterThanOrEqual((-2.85 / 30) - 0.001);
    expect(canDoubleJumpInAir).toBe(false);
    expect(state.height).toBe(flatWave.height);
  });

  it('keeps the board close to the water plane on steep wave faces', () => {
    const state = createInitialSurferState();
    const input = createInputState();
    const steepWave = makeWave({ height: 1.4, slopeX: 0.08, slopeZ: -1, lipPower: 0.8, facePower: 0.9 });

    const next = updateSurfer(state, input, steepWave, 0.25);

    expect(Math.abs(next.pitch)).toBeLessThan(0.36);
  });

  it('keeps traveling through the world instead of wrapping or resetting at old boundaries', () => {
    const state = createInitialSurferState();
    state.position.z = -120;
    state.wipeoutTimer = 3;
    const input = createInputState();
    const wave = makeWave({ height: 0.4, lipPower: 0.4, facePower: 0.7 });

    const next = updateSurfer(state, input, wave, 0.5);

    expect(next.position.z).toBeLessThan(-120);
    expect(next.position.z).not.toBe(70);
    expect(next.position.x).not.toBe(createInitialSurferState().position.x);
  });
});

describe('breaking wave field', () => {
  it('raises a high-energy curling wave at the pocket', () => {
    const crest = pointNearPocket(0, 0, 0);
    const atCrest = sampleWave(crest.x, crest.z, 0);
    const farLateral = sampleWave(crest.x, crest.z + 40, 0);

    expect(atCrest.height).toBeGreaterThan(2.2);
    expect(atCrest.curl).toBeGreaterThan(0.9);
    expect(atCrest.lipPower).toBeGreaterThan(0.7);
    expect(atCrest.height).toBeGreaterThan(farLateral.height + 1.4);
  });

  it('keeps the shoulder ahead of the peel green and the water behind it broken', () => {
    const shoulder = pointNearPocket(0, 0, -30);
    const broken = pointNearPocket(0, 0, 46);

    const shoulderWave = sampleWave(shoulder.x, shoulder.z, 0);
    const brokenWave = sampleWave(broken.x, broken.z, 0);

    expect(shoulderWave.curl).toBeLessThan(0.05);
    expect(shoulderWave.whitewater).toBeLessThan(0.05);
    expect(brokenWave.whitewater).toBeGreaterThan(0.5);
    expect(brokenWave.curl).toBeLessThan(0.1);
  });

  it('opens a barrel zone on the face just behind the peel', () => {
    const inTube = pointNearPocket(0, -2.2, 5);
    const onShoulder = pointNearPocket(0, -2.2, -25);

    expect(sampleWave(inTube.x, inTube.z, 0).barrelDepth).toBeGreaterThan(0.4);
    expect(sampleWave(onShoulder.x, onShoulder.z, 0).barrelDepth).toBe(0);
  });

  it('sweeps the pocket down the line as the wave travels', () => {
    const first = getPocketWorldPosition(0, 0, 0);
    const later = getPocketWorldPosition(
      1,
      BREAKER_TRAVEL.x * 7.2,
      BREAKER_TRAVEL.z * 7.2,
    );

    expect(later.waveIndex).toBe(first.waveIndex);
    expect(later.x).toBeLessThan(first.x - 6);
  });

  it('keeps the physics heightfield finite across the play area', () => {
    for (let x = -60; x <= 60; x += 12) {
      for (let z = -120; z <= 60; z += 9) {
        const wave = sampleWave(x, z, 4.2);
        expect(Number.isFinite(wave.height)).toBe(true);
        expect(Number.isFinite(wave.slopeX)).toBe(true);
        expect(Number.isFinite(wave.slopeZ)).toBe(true);
      }
    }
  });

  it('folds the rendered lip forward over the face inside the curl window', () => {
    const lipPoint = pointNearPocket(0, 1.2, 0);
    const lip = sampleSurface(lipPoint.x, lipPoint.z, 0);
    const shoulderPoint = pointNearPocket(0, 1.2, -30);
    const shoulder = sampleSurface(shoulderPoint.x, shoulderPoint.z, 0);

    expect(lip.offsetZ).toBeLessThan(-0.5);
    expect(lip.height).toBeLessThan(sampleWave(lipPoint.x, lipPoint.z, 0).height);
    expect(lip.thin).toBeGreaterThan(0.5);
    expect(Math.abs(shoulder.offsetZ)).toBeLessThan(0.05);
    expect(shoulder.thin).toBe(0);
  });

  it('marks foam over whitewater and the curling crest', () => {
    const broken = pointNearPocket(0, 0, 46);
    const shoulder = pointNearPocket(0, 0, -30);

    expect(sampleFoamField(broken.x, broken.z, 0).intensity).toBeGreaterThan(0.4);
    expect(sampleFoamField(shoulder.x, shoulder.z, 0).intensity).toBeLessThan(0.12);
  });
});

describe('wave set strips', () => {
  it('adds chaseable high-energy wave bands to the shared wave sampler', () => {
    const crest = pointNearPocket(0, 0, 0);
    const strip = sampleWaveSet(crest.x, crest.z, 0);
    const calm = sampleWaveSet(crest.x, crest.z + 40, 0);
    const wave = sampleWave(crest.x, crest.z, 0);

    expect(strip.height).toBeGreaterThan(calm.height + 1.4);
    expect(strip.crestStrength).toBeGreaterThan(0.6);
    expect(wave.facePower).toBeGreaterThan(0.5);
  });

  it('moves the wave bands through the world over time', () => {
    const firstPeak = findWaveSetPeakZ(0, -80, 20);
    const laterPeak = findWaveSetPeakZ(3, -80, 20);

    expect(laterPeak).toBeLessThan(firstPeak - 12);
  });
});

function findWaveSetPeakZ(time: number, minZ: number, maxZ: number): number {
  let bestZ = minZ;
  let bestHeight = -Infinity;

  for (let z = minZ; z <= maxZ; z += 1) {
    const height = sampleWaveSet(0, z, time).height;
    if (height > bestHeight) {
      bestHeight = height;
      bestZ = z;
    }
  }

  return bestZ;
}

describe('barrel riding', () => {
  it('accumulates barrel time and stoke while tucked in the tube', () => {
    let state = createInitialSurferState();
    const input = createInputState();
    const tubeWave = makeWave({ curl: 1, barrelDepth: 0.85, facePower: 0.9, lipPower: 0.6 });

    for (let frame = 0; frame < 40; frame += 1) {
      state = updateSurfer(state, input, tubeWave, 1 / 30);
    }

    expect(state.barrelTime).toBeGreaterThan(1);
    expect(state.barrelDepth).toBeGreaterThan(0.5);
    expect(state.stoke).toBeGreaterThan(createInitialSurferState().stoke);
  });

  it('rewards a completed barrel with a flash and remembered duration', () => {
    let state = createInitialSurferState();
    const input = createInputState();
    const tubeWave = makeWave({ curl: 1, barrelDepth: 0.85, facePower: 0.9 });

    for (let frame = 0; frame < 40; frame += 1) {
      state = updateSurfer(state, input, tubeWave, 1 / 30);
    }
    const ridden = state.barrelTime;
    state = updateSurfer(state, input, makeWave({ facePower: 0.5 }), 1 / 30);

    expect(state.barrelTime).toBe(0);
    expect(state.lastBarrelDuration).toBeCloseTo(ridden, 5);
    expect(state.barrelFlash).toBeGreaterThan(0.9);
  });

  it('carries the surfer down the line inside the pocket', () => {
    const state = createInitialSurferState();
    state.heading = 0;
    const input = createInputState();
    const pocketWave = makeWave({ curl: 1, barrelDepth: 0.6, facePower: 0.8 });

    const next = updateSurfer(state, input, pocketWave, 0.25);
    const still = updateSurfer(state, input, makeWave({ facePower: 0.8 }), 0.25);

    expect(next.position.x).toBeLessThan(still.position.x);
  });

  it('tracks pump effort and churn as smoothed animation drivers', () => {
    let state = createInitialSurferState();
    const input = createInputState();
    input.forward = 1;
    const foamWave = makeWave({ whitewater: 0.9, facePower: 0.4 });

    for (let frame = 0; frame < 30; frame += 1) {
      state = updateSurfer(state, input, foamWave, 1 / 30);
    }

    expect(state.pumpEffort).toBeGreaterThan(0.8);
    expect(state.churn).toBeGreaterThan(0.6);

    const idle = createInputState();
    for (let frame = 0; frame < 30; frame += 1) {
      state = updateSurfer(state, idle, makeWave({ facePower: 0.4 }), 1 / 30);
    }

    expect(state.pumpEffort).toBeLessThan(0.2);
    expect(state.churn).toBeLessThan(0.3);
  });

  it('pulses a decaying land impact after touching down from a jump', () => {
    let state = createInitialSurferState();
    const input = createInputState();
    input.trick = true;
    const flatWave = makeWave({ lipPower: 0.6, facePower: 0.4 });

    state = updateSurfer(state, input, flatWave, 1 / 30);
    input.trick = false;
    let peakImpact = 0;
    for (let frame = 0; frame < 140; frame += 1) {
      state = updateSurfer(state, input, flatWave, 1 / 30);
      peakImpact = Math.max(peakImpact, state.landImpact);
    }

    expect(peakImpact).toBeGreaterThan(0.1);
    expect(state.height).toBe(flatWave.height);
    expect(state.landImpact).toBeLessThan(peakImpact);
  });

  it('drags and shoves the surfer when caught by whitewater', () => {
    let churned = createInitialSurferState();
    let clean = createInitialSurferState();
    const input = createInputState();
    input.right = 1;
    const foamWave = makeWave({ whitewater: 1, facePower: 0.4 });
    const cleanWave = makeWave({ facePower: 0.4 });

    for (let frame = 0; frame < 60; frame += 1) {
      churned = updateSurfer(churned, input, foamWave, 1 / 30);
      clean = updateSurfer(clean, input, cleanWave, 1 / 30);
    }

    expect(churned.speed).toBeLessThan(6.5);
    expect(churned.speed).toBeLessThan(clean.speed);
    expect(churned.turn).toBeLessThan(clean.turn);
    expect(churned.position.z).toBeLessThan(clean.position.z);
    expect(churned.wipeoutTimer).toBeGreaterThan(0);
  });
});

describe('camera helpers', () => {
  it('damps heading through the shortest wrapped turn', () => {
    const nearlyPositivePi = Math.PI - 0.08;
    const nearlyNegativePi = -Math.PI + 0.08;
    const next = dampAngle(nearlyPositivePi, nearlyNegativePi, 4, 1 / 30);

    expect(next).toBeGreaterThan(nearlyPositivePi);
    expect(next).toBeLessThan(Math.PI + 0.08);
  });

  it('mirrors sim heading into Three.js render yaw so the board faces its travel direction', () => {
    expect(getSurferRenderHeading(-0.35)).toBeCloseTo(0.35);
  });

  it('mirrors sim bank into Three.js render roll so the board leans into the turn', () => {
    expect(getSurferRenderBank(-0.4)).toBeCloseTo(0.4);
  });

  it('sets the visual board close enough to sink into the wave surface', () => {
    expect(getSurferVisualHeight(1.2)).toBeCloseTo(1.4);
  });

  it('adds bounded wave-following trim to board pitch and bank', () => {
    const state = createInitialSurferState();
    const face = pointNearPocket(2.4, -8.5, -24);
    state.position = { x: face.x, z: face.z };
    state.heading = -0.55;
    state.speed = 12;
    state.height = sampleWave(state.position.x, state.position.z, 2.4).height;

    const trim = getOrganicBoardTrim(state, 2.4);

    expect(Math.abs(trim.pitch) + Math.abs(trim.bank)).toBeGreaterThan(0.015);
    expect(Math.abs(trim.pitch)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(trim.bank)).toBeLessThanOrEqual(0.24);
  });

  it('uses water probe rays to fit board pitch, bank, and support height', () => {
    const state = createInitialSurferState();
    const face = pointNearPocket(2.4, -8.5, -24);
    state.position = { x: face.x, z: face.z };
    state.heading = -0.55;
    state.speed = 12;
    const centerHeight = sampleWave(state.position.x, state.position.z, 2.4).height;
    state.height = centerHeight;

    const probePose = getBoardWaterProbePose(state, 2.4);

    expect(probePose.contact).toBeGreaterThan(0.8);
    expect(Math.abs(probePose.pitch) + Math.abs(probePose.bank)).toBeGreaterThan(0.04);
    expect(Math.abs(probePose.height - centerHeight)).toBeLessThan(1.5);
  });

  it('biases the water probe support toward a heavier tail', () => {
    const slowState = createInitialSurferState();
    const face = pointNearPocket(2.4, -8.5, -24);
    slowState.position = { x: face.x, z: face.z };
    slowState.heading = -0.55;
    slowState.speed = 4;
    slowState.height = sampleWave(slowState.position.x, slowState.position.z, 2.4).height;
    const fastState = { ...slowState, position: { ...slowState.position }, speed: 18 };

    const slowProbe = getBoardWaterProbePose(slowState, 2.4);
    const fastProbe = getBoardWaterProbePose(fastState, 2.4);

    expect(fastProbe.pitch).toBeGreaterThan(slowProbe.pitch);
    expect(fastProbe.height).toBeLessThan(slowProbe.height);
  });

  it('cuts probe-driven board contouring while airborne', () => {
    const state = createInitialSurferState();
    state.position = { x: -3.2, z: 14.5 };
    state.heading = -0.55;
    state.speed = 12;
    state.height = sampleWave(state.position.x, state.position.z, 2.4).height + 1.2;
    state.airtime = 0.5;
    state.verticalVelocity = 1;

    const probePose = getBoardWaterProbePose(state, 2.4);

    expect(probePose.contact).toBe(0);
  });
});

describe('water contact helpers', () => {
  it('cuts board contact while the surfer is airborne', () => {
    const state = createInitialSurferState();
    state.airtime = 0.45;
    state.verticalVelocity = 2.2;
    state.height = 0.2;

    expect(isBoardAirborne(state, 0.18)).toBe(true);
    expect(getBoardWaterContact(state, 0.18)).toBe(0);
  });

  it('allows full board contact while riding on the water', () => {
    const state = createInitialSurferState();
    state.airtime = 0;
    state.verticalVelocity = 0;
    state.height = 0.18;

    expect(isBoardAirborne(state, 0.18)).toBe(false);
    expect(getBoardWaterContact(state, 0.18)).toBeCloseTo(1);
  });
});

describe('surfer pose targets', () => {
  it('cycles four idle pose states for neutral grounded riding', () => {
    const state = createInitialSurferState();
    const targets = getSurferPoseTargets(state, 0.5);

    expect(targets.find((target) => target.name === 'default')?.weight).toBe(1);
    expect(targets.some((target) => target.name.startsWith('idle-') && target.weight > 0)).toBe(true);
  });

  it('maps carve direction to lean pose states', () => {
    const leftState = createInitialSurferState();
    leftState.turn = -0.9;
    leftState.bank = -0.5;
    const rightState = createInitialSurferState();
    rightState.turn = 0.9;
    rightState.bank = 0.5;

    expect(getSurferPoseTargets(leftState, 1).some((target) => target.name === 'left-lean' && target.weight > 0)).toBe(true);
    expect(getSurferPoseTargets(rightState, 1).some((target) => target.name === 'right-lean' && target.weight > 0)).toBe(true);
  });

  it('lets strong authored lean poses dominate the default stance', () => {
    const state = createInitialSurferState();
    state.turn = 1.25;
    state.bank = 0.78;

    const targets = getSurferPoseTargets(state, 1);

    expect(targets.find((target) => target.name === 'default')?.weight).toBeLessThan(0.3);
    expect(targets.find((target) => target.name === 'right-lean')?.weight).toBeGreaterThan(0.95);
  });

  it('tucks into the barrel pose while deep in the tube', () => {
    const state = createInitialSurferState();
    state.barrelDepth = 0.85;

    const targets = getSurferPoseTargets(state, 1);

    expect(targets.find((target) => target.name === 'barrel-tuck')?.weight).toBeGreaterThan(0.9);
    expect(targets.find((target) => target.name === 'default')?.weight).toBeLessThan(0.3);
  });

  it('braces through whitewater, hard falls, and landings', () => {
    const churned = createInitialSurferState();
    churned.churn = 1;
    const falling = createInitialSurferState();
    falling.airtime = 0.2;
    falling.verticalVelocity = -6;
    const landed = createInitialSurferState();
    landed.landImpact = 0.8;

    expect(getSurferPoseTargets(churned, 1).find((target) => target.name === 'brace')?.weight).toBeGreaterThan(0.8);
    expect(getSurferPoseTargets(falling, 1).find((target) => target.name === 'brace')?.weight).toBeGreaterThan(0.4);
    expect(getSurferPoseTargets(landed, 1).find((target) => target.name === 'brace')?.weight).toBeGreaterThan(0.7);
  });

  it('streamlines into a speed crouch when flying and pumping', () => {
    const state = createInitialSurferState();
    state.speed = 20;
    state.pumpEffort = 1;

    const targets = getSurferPoseTargets(state, 1);

    expect(targets.find((target) => target.name === 'speed-crouch')?.weight).toBeGreaterThan(0.5);
  });

  it('maps jump startup and airtime to separate pose states', () => {
    const start = createInitialSurferState();
    start.activeTrick = { name: 'Jump', timer: 0.03, duration: 0.4, spin: 0 };
    start.airtime = 0.8;
    start.verticalVelocity = 4;
    const air = createInitialSurferState();
    air.activeTrick = null;
    air.airtime = 0.5;
    air.verticalVelocity = -1.2;

    expect(getSurferPoseTargets(start, 1).some((target) => target.name === 'start-jump' && target.weight > 0.5)).toBe(true);
    expect(getSurferPoseTargets(air, 1).some((target) => target.name === 'air-jump' && target.weight > 0.4)).toBe(true);
  });
});

describe('ocean board deformation', () => {
  it('depresses the water under a skimming board', () => {
    const state = createInitialSurferState();
    state.position = { x: 0, z: 0 };
    state.height = 0;
    state.heading = 0;
    state.speed = 10;

    const deformation = getBoardWaterDeformation(0, 0, 0, state);

    expect(deformation.heightOffset).toBeLessThan(0);
    expect(deformation.alpha).toBeGreaterThan(0.4);
  });

  it('cuts the local water deformation while airborne', () => {
    const state = createInitialSurferState();
    state.position = { x: 0, z: 0 };
    state.height = 0;
    state.heading = 0;
    state.speed = 10;
    state.airtime = 0.5;
    state.verticalVelocity = 1;

    const deformation = getBoardWaterDeformation(0, 0, 0, state);

    expect(deformation.heightOffset).toBe(0);
    expect(deformation.alpha).toBe(0);
  });

  it('keeps the strongest live deformation under and behind the board', () => {
    const state = createInitialSurferState();
    state.position = { x: 0, z: 0 };
    state.height = 0;
    state.heading = 0;
    state.speed = 10;

    const nose = getBoardWaterDeformation(0, -2.1, 0, state);
    const tail = getBoardWaterDeformation(0, 2.1, 0, state);

    expect(Math.abs(tail.heightOffset)).toBeGreaterThan(Math.abs(nose.heightOffset));
  });

  it('fades stamped wake deformation back toward the original wave', () => {
    const fresh = getWakeStampDeformation(0, 0, {
      x: 0,
      z: 0,
      heading: 0,
      age: 0,
      lifetime: 1,
      strength: 1,
      width: 0.6,
      length: 1.2,
    });
    const faded = getWakeStampDeformation(0, 0, {
      x: 0,
      z: 0,
      heading: 0,
      age: 0.95,
      lifetime: 1,
      strength: 1,
      width: 0.6,
      length: 1.2,
    });

    expect(Math.abs(faded.heightOffset)).toBeLessThan(Math.abs(fresh.heightOffset) * 0.01);
  });
});
