import type { SurferState } from '../game/simulation/surfer';

export type Hud = {
  root: HTMLElement;
  update: (state: SurferState) => void;
};

export function createHud(): Hud {
  const root = document.createElement('div');
  root.className = 'hud';
  root.innerHTML = `
    <section class="hud__brand" aria-label="Game status">
      <span class="hud__place">Floripa Surfer</span>
      <strong class="hud__score" data-score>0</strong>
    </section>
    <section class="hud__trick" data-trick aria-live="polite"></section>
  `;

  const score = root.querySelector<HTMLElement>('[data-score]');
  const trick = root.querySelector<HTMLElement>('[data-trick]');

  if (!score || !trick) {
    throw new Error('HUD failed to initialize');
  }

  const scoreEl = score;
  const trickEl = trick;

  function update(state: SurferState): void {
    scoreEl.textContent = Math.round(state.score).toLocaleString('en-US');
    trickEl.textContent = state.activeTrick?.name ?? '';
    trickEl.classList.toggle('hud__trick--active', Boolean(state.activeTrick));
  }

  return { root, update };
}
