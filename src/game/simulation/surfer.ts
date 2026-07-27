import type { InputState } from '../input/inputState';
import { clamp, damp, lerp, type Vec2 } from './math';
import { BREAKER_TRAVEL, PEEL_DIRECTION, type WaveSample } from './waves';

const JUMP_ASCENT_GRAVITY = 8.2;
const JUMP_FALL_GRAVITY = 4.9;
const MAX_JUMP_FALL_SPEED = -2.85;
// Dropping off a ledge of water (no jump) falls at real gravity, so drop-ins
// down a barreling face land fast instead of parachuting.
const DROP_GRAVITY = 9.8;
const MAX_DROP_FALL_SPEED = -9;
const DROP_DETACH_SPEED = -1.5;
const LANDING_SURFACE_EPSILON = 0.025;
// How far the water can drop out from under a grounded board before it truly
// leaves the surface. Below this, the board sticks and rides the face down
// (dropping in), instead of floating off every steep section.
const SURFACE_STICK_RANGE = 0.6;
const SURFACE_FOLLOW_RATE = 22;
const BARREL_ENTRY_THRESHOLD = 0.3;
const BARREL_MIN_REWARD_TIME = 0.45;
const GRAVITY_SLIDE_GAIN_X = 2.6;
const GRAVITY_SLIDE_GAIN_Z = 2.0;
const GRAVITY_SLIDE_LIMIT = 3.2;
const WHITEWATER_SHOVE = 5.5;
const POCKET_ASSIST = 2.2;

export type ActiveTrick = {
  name: string;
  timer: number;
  duration: number;
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
  jumpAir: boolean;
  activeTrick: ActiveTrick | null;
  stoke: number;
  wipeoutTimer: number;
  barrelDepth: number;
  barrelTime: number;
  lastBarrelDuration: number;
  barrelFlash: number;
  pumpEffort: number;
  churn: number;
  landImpact: number;
};

export function createInitialSurferState(): SurferState {
  return {
    position: { x: -9, z: 6 },
    height: 0,
    speed: 9.5,
    heading: -0.35,
    turn: 0,
    bank: 0,
    pitch: 0,
    airtime: 0,
    verticalVelocity: 0,
    jumpAir: false,
    activeTrick: null,
    stoke: 0.45,
    wipeoutTimer: 0,
    barrelDepth: 0,
    barrelTime: 0,
    lastBarrelDuration: 0,
    barrelFlash: 0,
    pumpEffort: 0,
    churn: 0,
    landImpact: 0,
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
  const control = 1 - wave.whitewater * 0.55;
  const lipBoost = wave.lipPower * 1.7;
  const pocketDrive = wave.curl * (0.9 + wave.barrelDepth * 1.4);
  const carveDrag = Math.abs(steer) * 0.8;
  let targetSpeed = clamp(
    state.speed + pump * 7.5 * control * dt + lipBoost * dt + pocketDrive * dt - carveDrag * dt,
    4.5,
    22,
  );
  targetSpeed = lerp(targetSpeed, 5.2, wave.whitewater * 0.7);

  next.speed = damp(state.speed, targetSpeed, 8, dt);
  next.turn = damp(state.turn, steer * (1.25 + wave.facePower * 0.7) * control, 10, dt);
  next.heading += next.turn * dt;
  next.bank = damp(state.bank, steer * 0.78 - wave.slopeX * 1.1, 7.5, dt);
  const waterPitch = -Math.atan(wave.slopeZ) * 0.42;
  next.pitch = damp(state.pitch, clamp(waterPitch, -0.24, 0.32), 8, dt);

  // Gravity slides the board down the face; the peeling pocket carries it down
  // the line; broken whitewater shoves it toward the beach. The push off the
  // back slope (positive slideZ) is kept soft so the wave stays catchable from
  // behind at cruising speed.
  const slideX = clamp(-wave.slopeX * GRAVITY_SLIDE_GAIN_X, -GRAVITY_SLIDE_LIMIT, GRAVITY_SLIDE_LIMIT);
  const rawSlideZ = -wave.slopeZ * GRAVITY_SLIDE_GAIN_Z;
  const slideZ = clamp(rawSlideZ > 0 ? rawSlideZ * 0.45 : rawSlideZ, -GRAVITY_SLIDE_LIMIT, GRAVITY_SLIDE_LIMIT);
  const assist = wave.curl * (0.8 + wave.barrelDepth * 1.6) * POCKET_ASSIST;
  const shove = wave.whitewater * WHITEWATER_SHOVE;
  next.position.x +=
    Math.sin(next.heading) * next.speed * dt +
    (slideX + PEEL_DIRECTION.x * assist + BREAKER_TRAVEL.x * shove) * dt;
  next.position.z -= Math.cos(next.heading) * next.speed * dt;
  next.position.z += (slideZ + PEEL_DIRECTION.z * assist + BREAKER_TRAVEL.z * shove) * dt;

  const onWater = state.height <= wave.height + LANDING_SURFACE_EPSILON && state.verticalVelocity <= 0.02;
  if (input.trick && !next.activeTrick && onWater) {
    next.activeTrick = createJumpAction(wave.lipPower);
    next.airtime = Math.max(next.airtime, 0.85 + wave.lipPower * 0.4);
    next.verticalVelocity = 4.6 + wave.lipPower * 2.1;
    next.jumpAir = true;
  }

  const airborne =
    next.airtime > 0 ||
    state.height > wave.height + SURFACE_STICK_RANGE ||
    state.verticalVelocity !== 0;
  if (airborne) {
    if (!next.jumpAir && state.verticalVelocity === 0) {
      next.verticalVelocity = DROP_DETACH_SPEED;
    }
    next.airtime = Math.max(0, next.airtime - dt);
    const gravity = next.jumpAir
      ? next.verticalVelocity > 0
        ? JUMP_ASCENT_GRAVITY
        : JUMP_FALL_GRAVITY
      : DROP_GRAVITY;
    const fallCap = next.jumpAir ? MAX_JUMP_FALL_SPEED : MAX_DROP_FALL_SPEED;
    next.verticalVelocity = Math.max(fallCap, next.verticalVelocity - gravity * dt);
    const nextHeight = state.height + next.verticalVelocity * dt;
    if (next.verticalVelocity <= 0 && nextHeight <= wave.height + LANDING_SURFACE_EPSILON) {
      const impact = clamp((-next.verticalVelocity - 1.6) / 5.5, 0, 1);
      next.landImpact = Math.max(state.landImpact, impact);
      next.verticalVelocity = 0;
      next.airtime = 0;
      next.height = wave.height;
      next.jumpAir = false;
    } else {
      next.height = Math.max(wave.height, nextHeight);
    }
  } else {
    next.verticalVelocity = 0;
    next.jumpAir = false;
    next.height = damp(state.height, wave.height, SURFACE_FOLLOW_RATE, dt);
  }

  if (next.activeTrick) {
    next.activeTrick.timer += dt;
    if (next.activeTrick.timer >= next.activeTrick.duration) {
      next.activeTrick = null;
    }
  }

  const inTube =
    wave.barrelDepth > BARREL_ENTRY_THRESHOLD &&
    next.airtime <= 0 &&
    next.height <= wave.height + 0.3;
  next.barrelDepth = damp(state.barrelDepth, inTube ? wave.barrelDepth : 0, 6, dt);
  let flash = state.barrelFlash;
  if (inTube) {
    next.barrelTime = state.barrelTime + dt;
  } else {
    if (state.barrelTime > BARREL_MIN_REWARD_TIME) {
      next.lastBarrelDuration = state.barrelTime;
      flash = 1;
    }
    next.barrelTime = 0;
  }
  next.barrelFlash = Math.max(0, flash - dt / 2.4);

  // Smoothed animation drivers: how hard the rider is pumping, how much
  // churned water they are in, and a decaying landing-impact pulse.
  next.pumpEffort = damp(state.pumpEffort, clamp(pump, 0, 1), 6, dt);
  next.churn = damp(state.churn, wave.whitewater, 5, dt);
  next.landImpact = Math.max(0, next.landImpact - dt * 2.2);

  next.stoke = clamp(
    next.stoke +
      wave.facePower * 0.045 * dt +
      wave.barrelDepth * 0.28 * dt -
      wave.whitewater * 0.12 * dt -
      0.018 * dt,
    0,
    1,
  );

  const outOfPocket = (wave.facePower < 0.12 && next.speed < 6) || wave.whitewater > 0.55;
  next.wipeoutTimer = outOfPocket ? state.wipeoutTimer + dt : Math.max(0, state.wipeoutTimer - dt * 2);

  return next;
}

function createJumpAction(lipPower: number): ActiveTrick {
  return {
    name: 'Jump',
    timer: 0,
    duration: 0.36 + lipPower * 0.08,
    spin: 0,
  };
}
