import type { InputState } from '../input/inputState';
import { clamp, damp, type Vec2 } from './math';
import type { WaveSample } from './waves';

const JUMP_ASCENT_GRAVITY = 8.2;
const JUMP_FALL_GRAVITY = 4.9;
const MAX_JUMP_FALL_SPEED = -2.85;
const LANDING_SURFACE_EPSILON = 0.025;

export type ActiveTrick = {
  name: string;
  timer: number;
  duration: number;
  score: number;
  spin: number;
};

export type SurferState = {
  position: Vec2;
  height: number;
  speed: number;
  heading: number;
  turn: number;
  bank: number;
  pitch: number;
  airtime: number;
  verticalVelocity: number;
  activeTrick: ActiveTrick | null;
  combo: number;
  score: number;
  faceScore: number;
  stoke: number;
  wipeoutTimer: number;
};

export function createInitialSurferState(): SurferState {
  return {
    position: { x: -9, z: 20 },
    height: 0,
    speed: 9.5,
    heading: -0.35,
    turn: 0,
    bank: 0,
    pitch: 0,
    airtime: 0,
    verticalVelocity: 0,
    activeTrick: null,
    combo: 1,
    score: 0,
    faceScore: 0,
    stoke: 0.45,
    wipeoutTimer: 0,
  };
}

export function updateSurfer(state: SurferState, input: InputState, wave: WaveSample, dt: number): SurferState {
  const next: SurferState = {
    ...state,
    position: { ...state.position },
    activeTrick: state.activeTrick ? { ...state.activeTrick } : null,
  };

  const steer = input.right - input.left;
  const pump = input.forward - input.back * 0.75;
  const lipBoost = wave.lipPower * 1.7;
  const carveDrag = Math.abs(steer) * 0.8;
  const targetSpeed = clamp(state.speed + pump * 7.5 * dt + lipBoost * dt - carveDrag * dt, 4.5, 22);

  next.speed = damp(state.speed, targetSpeed, 8, dt);
  next.turn = damp(state.turn, steer * (1.25 + wave.facePower * 0.7), 10, dt);
  next.heading += next.turn * dt;
  next.bank = damp(state.bank, steer * 0.78 - wave.slopeX * 1.1, 7.5, dt);
  const waterPitch = -Math.atan(wave.slopeZ) * 0.42;
  next.pitch = damp(state.pitch, clamp(waterPitch, -0.24, 0.32), 8, dt);

  next.position.x += Math.sin(next.heading) * next.speed * dt + wave.slopeX * 5 * dt;
  next.position.z -= Math.cos(next.heading) * next.speed * dt;

  const onWater = state.height <= wave.height + LANDING_SURFACE_EPSILON && state.verticalVelocity <= 0.02;
  if (input.trick && !next.activeTrick && onWater) {
    next.activeTrick = createJumpAction(wave.lipPower);
    next.airtime = Math.max(next.airtime, 0.85 + wave.lipPower * 0.4);
    next.verticalVelocity = 4.6 + wave.lipPower * 2.1;
  }

  const airborne = next.airtime > 0 || state.height > wave.height + LANDING_SURFACE_EPSILON || state.verticalVelocity !== 0;
  if (airborne) {
    next.airtime = Math.max(0, next.airtime - dt);
    const gravity = next.verticalVelocity > 0 ? JUMP_ASCENT_GRAVITY : JUMP_FALL_GRAVITY;
    next.verticalVelocity = Math.max(MAX_JUMP_FALL_SPEED, next.verticalVelocity - gravity * dt);
    const nextHeight = state.height + next.verticalVelocity * dt;
    if (next.verticalVelocity <= 0 && nextHeight <= wave.height + LANDING_SURFACE_EPSILON) {
      next.verticalVelocity = 0;
      next.airtime = 0;
      next.height = wave.height;
    } else {
      next.height = Math.max(wave.height, nextHeight);
    }
  } else {
    next.verticalVelocity = 0;
    next.height = damp(state.height, wave.height, 16, dt);
  }

  if (next.activeTrick) {
    next.activeTrick.timer += dt;
    if (next.activeTrick.timer >= next.activeTrick.duration) {
      if (next.activeTrick.score > 0) {
        const landingBonus = next.airtime > 0 ? 1.15 : 0.85;
        next.score += Math.round(next.activeTrick.score * next.combo * landingBonus);
        next.stoke = clamp(next.stoke + 0.18, 0, 1);
      }
      next.activeTrick = null;
    }
  }

  const faceGain = wave.facePower * next.speed * dt * 0.55;
  next.faceScore += faceGain;
  next.score += faceGain;
  next.stoke = clamp(next.stoke + wave.facePower * 0.045 * dt - 0.018 * dt, 0, 1);

  const outOfPocket = wave.facePower < 0.12 && next.speed < 6;
  next.wipeoutTimer = outOfPocket ? state.wipeoutTimer + dt : Math.max(0, state.wipeoutTimer - dt * 2);

  return next;
}

function createJumpAction(lipPower: number): ActiveTrick {
  return {
    name: 'Jump',
    timer: 0,
    duration: 0.36 + lipPower * 0.08,
    score: 0,
    spin: 0,
  };
}
