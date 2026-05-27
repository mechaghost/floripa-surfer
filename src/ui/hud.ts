import type { SurferState } from '../game/simulation/surfer';

export type HudOptions = {
  initialMuted?: boolean;
  onMuteToggle?: (muted: boolean) => void;
};

export type Hud = {
  root: HTMLElement;
  update: (state: SurferState) => void;
  setMuted: (muted: boolean) => void;
};

export function createHud(options: HudOptions = {}): Hud {
  const { initialMuted = false, onMuteToggle } = options;

  const root = document.createElement('div');
  root.className = 'hud';
  root.innerHTML = `
    <section class="hud__brand" aria-label="Game status">
      <span class="hud__place">Floripa Surfer</span>
      <strong class="hud__score" data-score>0</strong>
    </section>
    <section class="hud__trick" data-trick aria-live="polite"></section>
    <button
      type="button"
      class="hud__mute"
      data-mute
      aria-label="Toggle sound"
      aria-pressed="false"
    ></button>
  `;

  const score = root.querySelector<HTMLElement>('[data-score]');
  const trick = root.querySelector<HTMLElement>('[data-trick]');
  const muteBtn = root.querySelector<HTMLButtonElement>('[data-mute]');

  if (!score || !trick || !muteBtn) {
    throw new Error('HUD failed to initialize');
  }

  let muted = initialMuted;
  applyMuteVisual();

  muteBtn.addEventListener('click', () => {
    muted = !muted;
    applyMuteVisual();
    onMuteToggle?.(muted);
  });

  function applyMuteVisual(): void {
    muteBtn!.textContent = muted ? '🔇' : '🔊';
    muteBtn!.setAttribute('aria-pressed', muted ? 'true' : 'false');
    muteBtn!.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    muteBtn!.classList.toggle('hud__mute--off', muted);
  }

  function update(state: SurferState): void {
    score!.textContent = Math.round(state.score).toLocaleString('en-US');
    trick!.textContent = state.activeTrick?.name ?? '';
    trick!.classList.toggle('hud__trick--active', Boolean(state.activeTrick));
  }

  function setMuted(value: boolean): void {
    if (value === muted) {
      return;
    }
    muted = value;
    applyMuteVisual();
  }

  return { root, update, setMuted };
}
