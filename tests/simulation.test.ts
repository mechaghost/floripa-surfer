import { describe, expect, it } from 'vitest';
import { createInitialSurferState, updateSurfer } from '../src/game/simulation/surfer';
import { createInputState } from '../src/game/input/inputState';
import { sampleWave } from '../src/game/simulation/waves';
import { dampAngle } from '../src/render/world';
import {
  getOrganicBoardTrim,
  getSurferPoseTargets,
  getSurferRenderBank,
  getSurferRenderHeading,
  getSurferVisualHeight,
} from '../src/render/surferModel';
import { getBoardWaterContact, isBoardAirborne } from '../src/render/waterContact';

describe('surfer simulation', () => {
  it('builds speed and face score when pumping down the wave', () => {
    const state = createInitialSurferState();
    const input = createInputState();
    input.forward = 1;

    const wave = sampleWave(state.position.x, state.position.z, 1.2);
    const next = updateSurfer(state, input, wave, 0.5);

    expect(next.speed).toBeGreaterThan(state.speed);
    expect(next.faceScore).toBeGreaterThan(state.faceScore);
    expect(next.stoke).toBeGreaterThan(state.stoke);
  });

  it('banks hard when carving left and preserves arcade control', () => {
    const state = createInitialSurferState();
    const input = createInputState();
    input.left = 1;

    const wave = sampleWave(state.position.x, state.position.z, 2);
    const next = updateSurfer(state, input, wave, 0.25);

    expect(next.turn).toBeLessThan(0);
    expect(next.bank).toBeLessThan(0);
    expect(next.speed).toBeGreaterThan(0);
  });

  it('banks hard when carving right and preserves arcade control', () => {
    const state = createInitialSurferState();
    const input = createInputState();
    input.right = 1;

    const wave = sampleWave(state.position.x, state.position.z, 2);
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

    const flatWave = { height: 0, slopeX: 0, slopeZ: 0, lipPower: 0.1, facePower: 0.2 };
    const jumped = updateSurfer(state, input, flatWave, 0.16);

    expect(jumped.activeTrick?.name).toBe('Jump');
    expect(jumped.airtime).toBeGreaterThan(0);
    expect(jumped.verticalVelocity).toBeGreaterThan(0);
    expect(jumped.combo).toBe(state.combo);
  });

  it('keeps a jump vertical instead of pitching the board up', () => {
    const state = createInitialSurferState();
    const input = createInputState();
    input.trick = true;

    const flatWave = { height: 0, slopeX: 0, slopeZ: 0, lipPower: 0.1, facePower: 0.2 };
    const jumped = updateSurfer(state, input, flatWave, 0.16);
    const airborne = updateSurfer(jumped, createInputState(), flatWave, 0.16);

    expect(airborne.height).toBeGreaterThan(state.height);
    expect(airborne.pitch).toBeCloseTo(0);
  });

  it('keeps jump descent from becoming too steep', () => {
    let state = createInitialSurferState();
    const input = createInputState();
    input.trick = true;
    const flatWave = { height: 0, slopeX: 0, slopeZ: 0, lipPower: 0.1, facePower: 0.2 };

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
    const flatWave = { height: 0, slopeX: 0, slopeZ: 0, lipPower: 0.1, facePower: 0.2 };

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
    const steepWave = { height: 1.4, slopeX: 0.08, slopeZ: -1, lipPower: 0.8, facePower: 0.9 };

    const next = updateSurfer(state, input, steepWave, 0.25);

    expect(Math.abs(next.pitch)).toBeLessThan(0.36);
  });

  it('keeps traveling through the world instead of wrapping or resetting at old boundaries', () => {
    const state = createInitialSurferState();
    state.position.z = -120;
    state.wipeoutTimer = 3;
    const input = createInputState();
    const wave = { height: 0.4, slopeX: 0, slopeZ: 0, lipPower: 0.4, facePower: 0.7 };

    const next = updateSurfer(state, input, wave, 0.5);

    expect(next.position.z).toBeLessThan(-120);
    expect(next.position.z).not.toBe(70);
    expect(next.position.x).not.toBe(createInitialSurferState().position.x);
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
    state.position = { x: -3.2, z: 14.5 };
    state.heading = -0.55;
    state.speed = 12;

    const trim = getOrganicBoardTrim(state, 2.4);

    expect(Math.abs(trim.pitch) + Math.abs(trim.bank)).toBeGreaterThan(0.015);
    expect(Math.abs(trim.pitch)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(trim.bank)).toBeLessThanOrEqual(0.24);
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

  it('maps jump startup and airtime to separate pose states', () => {
    const start = createInitialSurferState();
    start.activeTrick = { name: 'Jump', timer: 0.03, duration: 0.4, score: 0, spin: 0 };
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
