export type WaveSample = {
  height: number;
  slopeX: number;
  slopeZ: number;
  lipPower: number;
  facePower: number;
  curl: number;
  whitewater: number;
  barrelDepth: number;
  peel: number;
};

export type WaveSetSample = {
  height: number;
  slopeX: number;
  slopeZ: number;
  intensity: number;
  crestStrength: number;
};

export type SurfaceSample = {
  height: number;
  offsetX: number;
  offsetZ: number;
  curl: number;
  whitewater: number;
  foam: number;
  thin: number;
  cave: number;
  faceLight: number;
};

export type FoamFieldSample = {
  height: number;
  intensity: number;
  crestStrength: number;
  heading: number;
};

export type PocketPosition = {
  x: number;
  z: number;
  waveIndex: number;
};

// The breaker is the main playable wave set: periodic swell lines travelling
// shoreward (-z-ish) whose lip peels along the crest. The pocket sweeps in
// PEEL_DIRECTION, leaving whitewater behind it and green shoulder ahead of it.
const DIR_X = 0.1;
const DIR_Z = Math.sqrt(1 - DIR_X * DIR_X);
const SPEED = 7.2;
const PERIOD = 95;
const PHASE = 8;
const AMPLITUDE = 5.2;
const FACE_LENGTH = 8.2;
const BACK_LENGTH = 12;
const TROUGH_DEPTH = 1.1;
const TUBE_RADIUS = 2.6;
const PEEL_SPEED = 8.4;
const BARREL_LENGTH = 26;
const SHOULDER_RAMP = 17;
const COLLAPSE_RAMP = 12;
const WHITEWATER_FADE = 55;
const SLOPE_EPSILON = 0.4;

export const BREAKER_TRAVEL = { x: -DIR_X, z: -DIR_Z };
export const PEEL_DIRECTION = { x: -DIR_Z, z: DIR_X };
export const BREAKER_SPEED = SPEED;
export const BREAKER_PERIOD = PERIOD;
export const BREAKER_AMPLITUDE = AMPLITUDE;
export const BREAKER_TUBE_RADIUS = TUBE_RADIUS;

const CROSS_SET = {
  amplitude: 0.62,
  width: 16,
  period: 156,
  speed: 5.2,
  directionX: -0.235,
  directionZ: 0.972,
  phase: 54,
};

type BreakerField = {
  s: number;
  u: number;
  peel: number;
  curl: number;
  whitewater: number;
  height: number;
  crestGauss: number;
  faceGauss: number;
  proximity: number;
  barrelDepth: number;
};

function breakerField(x: number, z: number, time: number): BreakerField {
  const coordinate = x * DIR_X + z * DIR_Z + time * SPEED + PHASE;
  const k = Math.floor(coordinate / PERIOD + 0.5);
  const s = coordinate - k * PERIOD;
  const u = x * DIR_Z - z * DIR_X;
  const peel = u - pocketU(k, time);

  const curl =
    smoothstep(-SHOULDER_RAMP, -1.5, peel) *
    (1 - smoothstep(BARREL_LENGTH, BARREL_LENGTH + COLLAPSE_RAMP, peel));
  const brokenT = smoothstep(BARREL_LENGTH * 0.72, BARREL_LENGTH + COLLAPSE_RAMP, peel);
  const foamAge = Math.max(0, peel - BARREL_LENGTH - COLLAPSE_RAMP);
  const crestProximity = Math.exp(-(s * s) / 30);
  const whitewater = brokenT * Math.exp(-foamAge / WHITEWATER_FADE) * crestProximity;

  const ampEff = AMPLITUDE * (1 - brokenT * 0.45) * (1 + curl * 0.18);
  let ridge: number;
  if (s >= 0) {
    ridge = Math.exp(-(s * s) / (BACK_LENGTH * BACK_LENGTH) * 2.1);
  } else {
    // The curl compresses the upper face into a near-vertical wall while the
    // lower face keeps running out ahead, forming the shelf the tube sits on.
    const warp = 1 + curl * 2.4 * Math.exp(-(s * s) / (2.8 * 2.8));
    const sw = s * warp;
    ridge = Math.exp(-(sw * sw) / (FACE_LENGTH * FACE_LENGTH) * 2.1);
  }
  const troughCenter = s + FACE_LENGTH * 0.95;
  const trough =
    -TROUGH_DEPTH * (0.35 + curl * 0.65) * Math.exp(-(troughCenter * troughCenter) / (3.4 * 3.4));
  const churn = whitewater * 0.34 * Math.sin(u * 0.8 + s * 1.4 + time * 2.9);
  const height = ampEff * ridge + trough + churn;

  const crestGauss = Math.exp(-(s * s) / (2.0 * 2.0));
  const faceCenter = s + 2.7;
  const faceGauss = Math.exp(-(faceCenter * faceCenter) / (2.9 * 2.9));
  const proximity = Math.exp(-(s * s) / 110);

  const curlGate = smoothstep(0.55, 0.85, curl);
  const faceGate = smoothstep(-5.8, -3.4, s) * (1 - smoothstep(-1.5, -0.3, s));
  const peelGate =
    smoothstep(-2, 2.5, peel) * (1 - smoothstep(BARREL_LENGTH * 0.7, BARREL_LENGTH * 0.98, peel));
  const depthBonus = 0.45 + 0.55 * smoothstep(1, 12, peel);
  const barrelDepth = clamp01(curlGate * faceGate * peelGate * depthBonus);

  return { s, u, peel, curl, whitewater, height, crestGauss, faceGauss, proximity, barrelDepth };
}

function pocketU(waveIndex: number, time: number): number {
  const localTime = time - (waveIndex * PERIOD) / SPEED;
  return (pseudo(waveIndex * 17.23 + 3.7) - 0.5) * 76 - PEEL_SPEED * localTime;
}

function ambientHeight(x: number, z: number, time: number): number {
  return (
    0.38 * Math.sin(z * 0.085 + time * 0.85) +
    0.2 * Math.sin(z * 0.16 + x * 0.07 + time * 1.3) +
    0.12 * Math.sin(x * 0.2 - time * 1.05)
  );
}

function crossRidge(x: number, z: number, time: number): number {
  const coordinate =
    x * CROSS_SET.directionX + z * CROSS_SET.directionZ + time * CROSS_SET.speed + CROSS_SET.phase;
  const distance = wrapCentered(coordinate, CROSS_SET.period);
  const normalized = distance / CROSS_SET.width;
  return Math.exp(-normalized * normalized);
}

function surfaceHeight(x: number, z: number, time: number): number {
  return (
    breakerField(x, z, time).height +
    ambientHeight(x, z, time) +
    CROSS_SET.amplitude * crossRidge(x, z, time)
  );
}

export function sampleWave(x: number, z: number, time: number): WaveSample {
  const breaker = breakerField(x, z, time);
  const cross = crossRidge(x, z, time);
  const height = breaker.height + ambientHeight(x, z, time) + CROSS_SET.amplitude * cross;
  const slopeX =
    (surfaceHeight(x + SLOPE_EPSILON, z, time) - surfaceHeight(x - SLOPE_EPSILON, z, time)) /
    (2 * SLOPE_EPSILON);
  const slopeZ =
    (surfaceHeight(x, z + SLOPE_EPSILON, time) - surfaceHeight(x, z - SLOPE_EPSILON, time)) /
    (2 * SLOPE_EPSILON);

  const lipPower = clamp01(
    breaker.crestGauss * (0.3 + breaker.curl * 0.8) * (1 - breaker.whitewater * 0.5) + cross * 0.18,
  );
  const facePower = clamp01(
    0.16 +
      breaker.faceGauss * (0.4 + breaker.curl * 0.35) +
      breaker.proximity * 0.22 +
      breaker.whitewater * 0.12 +
      cross * 0.1,
  );

  return {
    height,
    slopeX,
    slopeZ,
    lipPower,
    facePower,
    curl: breaker.curl,
    whitewater: breaker.whitewater,
    barrelDepth: breaker.barrelDepth,
    peel: breaker.peel,
  };
}

export function sampleWaveSet(x: number, z: number, time: number): WaveSetSample {
  const breaker = breakerField(x, z, time);
  const cross = crossRidge(x, z, time);
  const height = breaker.height + CROSS_SET.amplitude * cross;
  const slopeX =
    (surfaceHeight(x + SLOPE_EPSILON, z, time) - surfaceHeight(x - SLOPE_EPSILON, z, time)) /
    (2 * SLOPE_EPSILON);
  const slopeZ =
    (surfaceHeight(x, z + SLOPE_EPSILON, time) - surfaceHeight(x, z - SLOPE_EPSILON, time)) /
    (2 * SLOPE_EPSILON);

  return {
    height,
    slopeX,
    slopeZ,
    intensity: clamp01(breaker.proximity * (0.55 + breaker.curl * 0.45) + cross * 0.3),
    crestStrength: clamp01(
      breaker.crestGauss * (0.45 + breaker.curl * 0.55) + breaker.whitewater * 0.5 + cross * 0.3,
    ),
  };
}

// Render-side sample: physics height plus the visual curl displacement that
// folds the lip forward over the face. Returns into a caller-provided target to
// avoid allocating inside the per-vertex ocean loop.
export function sampleSurfaceInto(
  target: SurfaceSample,
  x: number,
  z: number,
  time: number,
): SurfaceSample {
  const breaker = breakerField(x, z, time);
  const cross = crossRidge(x, z, time);
  const baseHeight = breaker.height + ambientHeight(x, z, time) + CROSS_SET.amplitude * cross;

  let offsetX = 0;
  let offsetZ = 0;
  let height = baseHeight;
  let thin = 0;
  let lipFoam = 0;
  let cave = 0;

  if (breaker.curl > 0.02) {
    const heightFrac = Math.pow(clamp01(baseHeight / (AMPLITUDE * 0.8)), 1.35);
    // Asymmetric band: only the rows just around the crest fly forward as the
    // lip; the upper face beneath stays put as the tube wall.
    const lipCenter = breaker.s - 1.2;
    const lipSigma = breaker.s > 1.2 ? 1.1 : 1.65;
    const lipBand = Math.exp(-(lipCenter * lipCenter) / (lipSigma * lipSigma));
    const faceCenter = breaker.s + 1.4;
    const faceBand = Math.exp(-(faceCenter * faceCenter) / (1.9 * 1.9));
    const pushLip = clamp01(breaker.curl * lipBand * heightFrac);
    const pushFace = clamp01(breaker.curl * faceBand * heightFrac);
    const forward = pushLip * TUBE_RADIUS * 2.9 + pushFace * TUBE_RADIUS * 0.45;
    // Sharp droop curve: the roof of the tube stays high while the outer
    // curtain plunges toward the flats.
    const droop = Math.pow(pushLip, 2.6) * AMPLITUDE * 0.78 * breaker.curl;

    offsetX = -DIR_X * forward;
    offsetZ = -DIR_Z * forward;
    height = baseHeight - droop;
    thin = smoothstep(0.3, 0.72, pushLip) * breaker.curl;
    lipFoam = smoothstep(0.78, 0.97, pushLip) * breaker.curl;
    cave =
      breaker.curl *
      breaker.faceGauss *
      smoothstep(-1.5, 1.5, breaker.peel) *
      (1 - smoothstep(BARREL_LENGTH * 0.8, BARREL_LENGTH + COLLAPSE_RAMP, breaker.peel));
  }

  const foam = clamp01(
    lipFoam +
      breaker.whitewater * (0.6 + 0.4 * Math.sin(breaker.u * 1.7 + breaker.s * 2.2 + time * 3.4)) +
      breaker.crestGauss * breaker.curl * 0.28 +
      cross * 0.12,
  );

  target.height = height;
  target.offsetX = offsetX;
  target.offsetZ = offsetZ;
  target.curl = breaker.curl;
  target.whitewater = breaker.whitewater;
  target.foam = foam;
  target.thin = thin;
  target.cave = clamp01(cave);
  target.faceLight = clamp01(
    breaker.faceGauss * (0.55 + 0.45 * breaker.curl) + breaker.proximity * 0.42,
  );
  return target;
}

export function sampleSurface(x: number, z: number, time: number): SurfaceSample {
  return sampleSurfaceInto(
    {
      height: 0,
      offsetX: 0,
      offsetZ: 0,
      curl: 0,
      whitewater: 0,
      foam: 0,
      thin: 0,
      cave: 0,
      faceLight: 0,
    },
    x,
    z,
    time,
  );
}

export function sampleFoamField(x: number, z: number, time: number): FoamFieldSample {
  const breaker = breakerField(x, z, time);
  const cross = crossRidge(x, z, time);

  return {
    height: breaker.height + ambientHeight(x, z, time) + CROSS_SET.amplitude * cross,
    intensity: clamp01(
      breaker.whitewater * 0.95 + breaker.curl * breaker.crestGauss * 0.8 + cross * 0.18,
    ),
    crestStrength: clamp01(
      breaker.crestGauss * (0.45 + breaker.curl * 0.55) + breaker.whitewater * 0.55 + cross * 0.25,
    ),
    heading: Math.atan2(-DIR_X, -DIR_Z),
  };
}

// World position of the breaking pocket on the wave the given point should
// chase: the nearest crest that is still catchable (approaching, or passed
// shoreward by less than a sprint), otherwise the next one arriving.
export function getPocketWorldPosition(time: number, nearX: number, nearZ: number): PocketPosition {
  const coordinate = nearX * DIR_X + nearZ * DIR_Z + time * SPEED + PHASE;
  let waveIndex = Math.floor(coordinate / PERIOD + 0.5);
  if (coordinate - waveIndex * PERIOD > 18) {
    waveIndex += 1;
  }
  // Aim at the porch: the spot on the face under the curl (s = -3.2), not the
  // crest itself, so chasing this point puts a rider in the tube zone.
  const porchCoordinate = waveIndex * PERIOD - time * SPEED - PHASE - 3.2;
  const pocket = pocketU(waveIndex, time);

  return {
    x: porchCoordinate * DIR_X + pocket * DIR_Z,
    z: porchCoordinate * DIR_Z - pocket * DIR_X,
    waveIndex,
  };
}

export function getCrestZ(waveIndex: number, x: number, time: number): number {
  return (waveIndex * PERIOD - PHASE - time * SPEED - x * DIR_X) / DIR_Z;
}

export function getNearestCrestIndex(x: number, z: number, time: number): number {
  return Math.floor((x * DIR_X + z * DIR_Z + time * SPEED + PHASE) / PERIOD + 0.5);
}

function pseudo(value: number): number {
  const raw = Math.sin(value * 12.9898) * 43758.5453;
  return raw - Math.floor(raw);
}

function wrapCentered(value: number, period: number): number {
  return value - Math.floor(value / period + 0.5) * period;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
