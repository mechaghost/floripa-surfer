import { describe, expect, it } from 'vitest';
import { createInitialSurferState, updateSurfer } from '../src/game/simulation/surfer';
import { createInputState } from '../src/game/input/inputState';
import { sampleWave } from '../src/game/simulation/waves';
import { dampAngle } from '../src/render/world';
import { getSurferRenderBank, getSurferRenderHeading } from '../src/render/surferModel';

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
});
