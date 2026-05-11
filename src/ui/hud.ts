import type { SurferState } from '../game/simulation/surfer';

export type Hud = {
  root: HTMLElement;
  update: (state: SurferState) => void;
};

export function createHud(): Hud {
  const root = document.createElement('div');
  root.className = 'hud';
  root.innerHTML = `
    <section class="hud__brand" aria-label="Game title">
      <span class="hud__place">Floripa Surfer</span>
    </section>
    <section class="hud__trick" data-trick aria-live="polite"></section>
  `;

  const trick = root.querySelector<HTMLElement>('[data-trick]');

  if (!trick) {
    throw new Error('HUD failed to initialize');
  }

  const trickEl = trick;

  function update(state: SurferState): void {
    trickEl.textContent = state.activeTrick?.name ?? '';
    trickEl.classList.toggle('hud__trick--active', Boolean(state.activeTrick));
  }

  return { root, update };
}
