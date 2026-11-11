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
const COMBO_WINDOW = 5;

type RideScore = {
  total: number;
  combo: number;
  remaining: number;
  lastMove: string;
  lastPoints: number;
};

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
  jumpHeld: boolean;
  jumpBuffer: number;
  flightTime: number;
  takeoffPower: number;
  drift: Vec2;
  carveAngle: number;
  lastCarve: number;
  ride: RideScore;
  activeTrick: ActiveTrick | null;
  stoke: number;
  wipeoutTimer: number;
  barrelDepth: number;
  barrelTime: number;
  lastBarrelDuration: number;
  barrelFlash: number;
  pumpEffort: number;
  pumpPhase: number;
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
    jumpHeld: false,
    jumpBuffer: 0,
    flightTime: 0,
    takeoffPower: 0,
    drift: { x: 0, z: 0 },
    carveAngle: 0,
    lastCarve: 0,
    ride: { total: 0, combo: 0, remaining: 0, lastMove: '', lastPoints: 0 },
    activeTrick: null,
    stoke: 0.45,
    wipeoutTimer: 0,
    barrelDepth: 0,
    barrelTime: 0,
    lastBarrelDuration: 0,
    barrelFlash: 0,
    pumpEffort: 0,
    pumpPhase: 0,
    churn: 0,
    landImpact: 0,
  };
}

export function updateSurfer(
  state: SurferState,
  input: InputState,
  wave: WaveSample,
  dt: number,
  sampleDestination?: (position: Vec2) => WaveSample,
): SurferState {
  const comboTime = Math.max(0, state.ride.remaining - dt);
  const next: SurferState = {
    ...state,
    position: { ...state.position },
    drift: { ...state.drift },
    activeTrick: state.activeTrick ? { ...state.activeTrick } : null,
    ride: { ...state.ride, remaining: comboTime, combo: comboTime > 0 ? state.ride.combo : 0 },
    jumpHeld: input.trick,
    jumpBuffer: input.jumpPressed || (input.trick && !state.jumpHeld) ? 0.16 : Math.max(0, state.jumpBuffer - dt),
  };

  const steer = input.right - input.left;
  const pump = input.forward - input.back * 0.75;
  const wasAirborne = state.airtime > 0 || state.verticalVelocity !== 0;
  const onWater = !wasAirborne && state.height <= wave.height + SURFACE_STICK_RANGE;
  const jumping = next.jumpBuffer > 0 && onWater && !next.activeTrick;
  const riding = onWater && !jumping;
  const control = riding ? 1 - wave.whitewater * 0.55 : 0.38;
  const alongBoard = wave.slopeX * Math.sin(state.heading) - wave.slopeZ * Math.cos(state.heading);
  const downhillDrive = clamp(-alongBoard * 5.8, -3.5, 6);
  const face = clamp((wave.facePower - 0.24) / 0.56, 0, 1);
  const pumpDrive = pump * (2.8 + face * 5.6) * control;
  const waveDrive = downhillDrive + wave.lipPower * 1.9 + wave.curl * face * 2.6;
  const drag = (state.speed - (7.5 + face * 2.8)) * 0.52 + Math.abs(steer) * 0.9;

  if (riding) {
    next.speed = clamp(state.speed + (pumpDrive + waveDrive - drag) * dt, 4.5, 21);
    next.speed = damp(next.speed, 5.2, wave.whitewater * 3.6, dt);
  }
  const railGrip = lerp(0.8, 1.17, clamp((state.speed - 5) / 10, 0, 1));
  next.turn = damp(state.turn, steer * (1.32 + face * 0.66) * railGrip * control, riding ? 7.5 : 4.5, dt);
  next.heading += next.turn * dt;
  next.bank = damp(state.bank, steer * (riding ? 0.78 : 0.2), 7.5, dt);
  const waterPitch = riding ? Math.atan(alongBoard) * -0.42 : 0;
  next.pitch = damp(state.pitch, clamp(waterPitch, -0.24, 0.32), 8, dt);

  // Gravity slides the board down the face; the peeling pocket carries it down
  // the line; broken whitewater shoves it toward the beach. The push off the
  // back slope (positive slideZ) is kept soft so the wave stays catchable from
  // behind at cruising speed.
  const slideX = clamp(-wave.slopeX * GRAVITY_SLIDE_GAIN_X, -GRAVITY_SLIDE_LIMIT, GRAVITY_SLIDE_LIMIT);
  const rawSlideZ = -wave.slopeZ * GRAVITY_SLIDE_GAIN_Z;
  const slideZ = clamp(rawSlideZ > 0 ? rawSlideZ * 0.45 : rawSlideZ, -GRAVITY_SLIDE_LIMIT, GRAVITY_SLIDE_LIMIT);
  const assist = wave.curl * face * (0.8 + wave.barrelDepth * 1.6) * POCKET_ASSIST;
  const shove = wave.whitewater * WHITEWATER_SHOVE;
  const carry = face * (0.8 + wave.lipPower * 1.25) + shove;
  if (riding) {
    next.drift.x = damp(state.drift.x, slideX + PEEL_DIRECTION.x * assist + BREAKER_TRAVEL.x * carry, 5.5, dt);
    next.drift.z = damp(state.drift.z, slideZ + PEEL_DIRECTION.z * assist + BREAKER_TRAVEL.z * carry, 5.5, dt);
  }
  next.position.x += (Math.sin(next.heading) * next.speed + next.drift.x) * dt;
  next.position.z += (-Math.cos(next.heading) * next.speed + next.drift.z) * dt;
  const destination = sampleDestination?.(next.position) ?? wave;
  const surfaceSpeed = (destination.height - wave.height) / Math.max(dt, 0.001);

  if (jumping) {
    next.activeTrick = createJumpAction(wave.lipPower);
    next.airtime = Math.max(next.airtime, 0.85 + wave.lipPower * 0.4);
    next.verticalVelocity = 4.6 + wave.lipPower * 2.1;
    next.jumpAir = true;
    next.jumpBuffer = 0;
    next.takeoffPower = Math.max(face, wave.lipPower);
  }

  const airborne =
    next.airtime > 0 ||
    state.height > destination.height + SURFACE_STICK_RANGE ||
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
    const startHeight = jumping ? Math.max(state.height, wave.height) : state.height;
    const nextHeight = startHeight + next.verticalVelocity * dt;
    const closingSpeed = surfaceSpeed - next.verticalVelocity;
    next.flightTime = state.flightTime + dt;
    if (closingSpeed >= 0 && nextHeight <= destination.height + LANDING_SURFACE_EPSILON) {
      const impact = clamp((closingSpeed - 1.6) / 5.5, 0, 1);
      next.landImpact = Math.max(state.landImpact, impact);
      next.verticalVelocity = 0;
      next.airtime = 0;
      next.height = destination.height;
      next.jumpAir = false;
      if (state.jumpAir && state.takeoffPower > 0.2 && next.flightTime > 0.35 &&
        destination.whitewater < 0.6 && impact < 0.92) {
        const points = Math.round(55 + next.flightTime * 42 + state.takeoffPower * 55 + next.speed * 2);
        award(next.ride, 'Clean Air', points);
      }
      next.flightTime = 0;
      next.takeoffPower = 0;
    } else {
      next.height = Math.max(destination.height, nextHeight);
    }
  } else {
    next.verticalVelocity = 0;
    next.jumpAir = false;
    next.height = destination.height + (state.height - wave.height) * Math.exp(-SURFACE_FOLLOW_RATE * dt);
  }

  if (next.activeTrick) {
    next.activeTrick.timer += dt;
    if (next.activeTrick.timer >= next.activeTrick.duration) {
      next.activeTrick = null;
    }
  }

  const inTube =
    destination.barrelDepth > BARREL_ENTRY_THRESHOLD &&
    next.airtime <= 0 && next.verticalVelocity === 0 &&
    next.height <= destination.height + 0.3;
  next.barrelDepth = damp(state.barrelDepth, inTube ? destination.barrelDepth : 0, 6, dt);
  let flash = state.barrelFlash;
  if (inTube) {
    next.barrelTime = state.barrelTime + dt;
  } else {
    if (state.barrelTime > BARREL_MIN_REWARD_TIME && destination.whitewater < 0.5) {
      next.lastBarrelDuration = state.barrelTime;
      flash = 1;
      award(next.ride, 'Barrel Exit', Math.round(120 + state.barrelTime * 150));
    }
    next.barrelTime = 0;
  }
  next.barrelFlash = Math.max(0, flash - dt / 2.4);

  if (destination.whitewater > 0.58 && next.verticalVelocity === 0) {
    next.ride.combo = 0;
    next.ride.remaining = 0;
  }
  if (riding && face > 0.35 && destination.whitewater < 0.38 && Math.abs(steer) > 0.45) {
    const direction = Math.sign(steer);
    next.carveAngle = Math.sign(state.carveAngle) === direction ? state.carveAngle : 0;
    next.carveAngle += direction * Math.max(0, next.turn * direction) * dt;
    if (Math.abs(next.carveAngle) > 0.46 && direction !== state.lastCarve) {
      award(next.ride, 'Power Carve', Math.round(45 + face * 30 + next.speed * 2));
      next.lastCarve = direction;
    }
  } else {
    next.carveAngle = 0;
    if (face < 0.2 || next.ride.combo === 0) next.lastCarve = 0;
  }

  // Smoothed animation drivers: how hard the rider is pumping, how much
  // churned water they are in, and a decaying landing-impact pulse.
  next.pumpEffort = damp(state.pumpEffort, clamp(pump, 0, 1), 6, dt);
  next.pumpPhase = (state.pumpPhase + dt * (5.2 + next.speed * 0.11)) % (Math.PI * 2);
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

function award(ride: RideScore, move: string, points: number): void {
  ride.combo = Math.min(5, ride.combo + 1);
  ride.remaining = COMBO_WINDOW;
  ride.lastMove = move;
  ride.lastPoints = points * ride.combo;
  ride.total += ride.lastPoints;
}

function createJumpAction(lipPower: number): ActiveTrick {
  return {
    name: 'Jump',
    timer: 0,
    duration: 0.36 + lipPower * 0.08,
    spin: 0,
  };
}
