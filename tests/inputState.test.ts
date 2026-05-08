import { describe, expect, it } from 'vitest';
import { applyPadInput, createInputState } from '../src/game/input/inputState';

describe('touch pad input mapping', () => {
  it('maps a left drag to left carving input', () => {
    const input = createInputState();

    applyPadInput(input, -0.8, 0);

    expect(input.left).toBeGreaterThan(0);
    expect(input.right).toBe(0);
  });

  it('maps a right drag to right carving input', () => {
    const input = createInputState();

    applyPadInput(input, 0.8, 0);

    expect(input.right).toBeGreaterThan(0);
    expect(input.left).toBe(0);
  });
});
