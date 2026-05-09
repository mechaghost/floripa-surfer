import type { SurferState } from '../game/simulation/surfer';

const AIRBORNE_VELOCITY_EPSILON = 0.02;
const CONTACT_CLEARANCE = 0.06;
const CONTACT_FADE_RANGE = 0.14;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function isBoardAirborne(state: Pick<SurferState, 'airtime' | 'height' | 'verticalVelocity'>, waterHeight: number): boolean {
  return (
    state.airtime > 0 ||
    Math.abs(state.verticalVelocity) > AIRBORNE_VELOCITY_EPSILON ||
    state.height > waterHeight + CONTACT_CLEARANCE
  );
}

export function getBoardWaterContact(
  state: Pick<SurferState, 'airtime' | 'height' | 'verticalVelocity'>,
  waterHeight: number,
): number {
  if (isBoardAirborne(state, waterHeight)) {
    return 0;
  }

  const clearance = state.height - waterHeight;
  return clamp01((CONTACT_FADE_RANGE - clearance) / CONTACT_FADE_RANGE);
}
