export type WaveSample = {
  height: number;
  slopeX: number;
  slopeZ: number;
  lipPower: number;
  facePower: number;
};

export function sampleWave(x: number, z: number, time: number): WaveSample {
  const swellA = Math.sin(z * 0.12 + time * 1.35);
  const swellB = Math.sin(z * 0.21 + x * 0.08 + time * 1.9);
  const sideChop = Math.sin(x * 0.17 - time * 1.15);
  const barrelPulse = Math.pow(Math.max(0, Math.sin(z * 0.075 - time * 0.85 + 1.5)), 3);
  const height = swellA * 1.45 + swellB * 0.55 + sideChop * 0.25 + barrelPulse * 2.2;
  const slopeX = Math.cos(x * 0.17 - time * 1.15) * 0.17 * 0.25 + Math.cos(z * 0.21 + x * 0.08 + time * 1.9) * 0.08 * 0.55;
  const slopeZ = Math.cos(z * 0.12 + time * 1.35) * 0.12 * 1.45 + Math.cos(z * 0.21 + x * 0.08 + time * 1.9) * 0.21 * 0.55;
  const steepness = Math.abs(slopeZ) * 4.8 + Math.max(0, height - 1.1) * 0.45;
  const lipPower = Math.min(1, Math.max(0, steepness));
  const facePower = Math.min(1, Math.max(0, 0.35 + height * 0.18 + Math.abs(slopeZ) * 2.3));

  return { height, slopeX, slopeZ, lipPower, facePower };
}
