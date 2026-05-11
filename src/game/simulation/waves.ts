export type WaveSample = {
  height: number;
  slopeX: number;
  slopeZ: number;
  lipPower: number;
  facePower: number;
};

export type WaveSetSample = {
  height: number;
  slopeX: number;
  slopeZ: number;
  intensity: number;
  crestStrength: number;
};

type WaveStripConfig = {
  amplitude: number;
  width: number;
  period: number;
  speed: number;
  directionX: number;
  directionZ: number;
  phase: number;
};

const PRIMARY_SET: WaveStripConfig = {
  amplitude: 2.35,
  width: 11.5,
  period: 88,
  speed: 10.8,
  directionX: 0.16,
  directionZ: 0.99,
  phase: 8,
};

const CROSS_SET: WaveStripConfig = {
  amplitude: 1.25,
  width: 17,
  period: 156,
  speed: 6.4,
  directionX: -0.24,
  directionZ: 0.97,
  phase: 54,
};

export function sampleWave(x: number, z: number, time: number): WaveSample {
  const swellA = Math.sin(z * 0.12 + time * 1.35);
  const swellB = Math.sin(z * 0.21 + x * 0.08 + time * 1.9);
  const sideChop = Math.sin(x * 0.17 - time * 1.15);
  const barrelPulse = Math.pow(Math.max(0, Math.sin(z * 0.075 - time * 0.85 + 1.5)), 3);
  const waveSet = sampleWaveSet(x, z, time);
  const height = swellA * 1.45 + swellB * 0.55 + sideChop * 0.25 + barrelPulse * 2.2 + waveSet.height;
  const slopeX =
    Math.cos(x * 0.17 - time * 1.15) * 0.17 * 0.25 +
    Math.cos(z * 0.21 + x * 0.08 + time * 1.9) * 0.08 * 0.55 +
    waveSet.slopeX;
  const slopeZ =
    Math.cos(z * 0.12 + time * 1.35) * 0.12 * 1.45 +
    Math.cos(z * 0.21 + x * 0.08 + time * 1.9) * 0.21 * 0.55 +
    waveSet.slopeZ;
  const steepness =
    Math.abs(slopeZ) * 4.8 +
    Math.max(0, height - 1.1) * 0.45 +
    waveSet.crestStrength * 0.65;
  const lipPower = clamp01(steepness);
  const facePower = clamp01(0.35 + height * 0.18 + Math.abs(slopeZ) * 2.3 + waveSet.intensity * 0.28);

  return { height, slopeX, slopeZ, lipPower, facePower };
}

export function sampleWaveSet(x: number, z: number, time: number): WaveSetSample {
  const primary = sampleMovingStrip(x, z, time, PRIMARY_SET);
  const cross = sampleMovingStrip(x, z, time, CROSS_SET);
  const interaction = primary.intensity * cross.intensity;

  return {
    height: primary.height + cross.height + interaction * 0.9,
    slopeX: primary.slopeX + cross.slopeX + interaction * 0.02,
    slopeZ: primary.slopeZ + cross.slopeZ + interaction * 0.05,
    intensity: clamp01(primary.intensity + cross.intensity * 0.72 + interaction * 0.36),
    crestStrength: clamp01(primary.crestStrength + cross.crestStrength * 0.66 + interaction * 0.5),
  };
}

function sampleMovingStrip(x: number, z: number, time: number, config: WaveStripConfig): WaveSetSample {
  const coordinate = x * config.directionX + z * config.directionZ + time * config.speed + config.phase;
  const distance = wrapCentered(coordinate, config.period);
  const normalizedDistance = distance / config.width;
  const ridge = Math.exp(-normalizedDistance * normalizedDistance);
  const face = smoothstep(-1.45, -0.18, normalizedDistance) * (1 - smoothstep(0.35, 1.45, normalizedDistance));
  const crest = Math.exp(-Math.pow((distance + config.width * 0.18) / (config.width * 0.34), 2));
  const height = config.amplitude * ridge * (0.82 + face * 0.34);
  const derivative =
    config.amplitude *
    ridge *
    (-2 * distance / (config.width * config.width)) *
    (0.82 + face * 0.34);

  return {
    height,
    slopeX: derivative * config.directionX,
    slopeZ: derivative * config.directionZ,
    intensity: ridge,
    crestStrength: crest * ridge,
  };
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
