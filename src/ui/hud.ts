import type { SurferState } from '../game/simulation/surfer';

export type HudOptions = {
  initialMuted?: boolean;
  onMuteToggle?: (muted: boolean) => void;
};

export type HudPocketInfo = {
  x: number;
  z: number;
};

export type Hud = {
  root: HTMLElement;
  update: (state: SurferState, pocket: HudPocketInfo) => void;
  setMuted: (muted: boolean) => void;
};

const POCKET_ARROW_HIDE_DISTANCE = 11;

export function createHud(options: HudOptions = {}): Hud {
  const { initialMuted = false, onMuteToggle } = options;

  const root = document.createElement('div');
  root.className = 'hud';
  root.innerHTML = `
    <section class="hud__brand" aria-label="Game title">
      <span class="hud__place">Floripa Surfer</span>
    </section>
    <section class="hud__barrel" data-barrel aria-live="polite"></section>
    <section class="hud__trick" data-trick aria-live="polite"></section>
    <section class="hud__stoke" aria-label="Stoke meter">
      <div class="hud__stoke-fill" data-stoke></div>
    </section>
    <div class="hud__pocket" data-pocket aria-hidden="true">▲</div>
    <button
      type="button"
      class="hud__mute"
      data-mute
      aria-label="Toggle sound"
      aria-pressed="false"
    ></button>
  `;

  const trick = root.querySelector<HTMLElement>('[data-trick]');
  const barrel = root.querySelector<HTMLElement>('[data-barrel]');
  const stoke = root.querySelector<HTMLElement>('[data-stoke]');
  const pocketArrow = root.querySelector<HTMLElement>('[data-pocket]');
  const muteBtn = root.querySelector<HTMLButtonElement>('[data-mute]');

  if (!trick || !barrel || !stoke || !pocketArrow || !muteBtn) {
    throw new Error('HUD failed to initialize');
  }

  const trickEl = trick;
  const barrelEl = barrel;
  const stokeEl = stoke;
  const pocketEl = pocketArrow;
  const muteEl = muteBtn;

  let muted = initialMuted;
  applyMuteVisual();

  muteEl.addEventListener('click', () => {
    muted = !muted;
    applyMuteVisual();
    onMuteToggle?.(muted);
  });

  function applyMuteVisual(): void {
    muteEl.textContent = muted ? '🔇' : '🔊';
    muteEl.setAttribute('aria-pressed', muted ? 'true' : 'false');
    muteEl.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    muteEl.classList.toggle('hud__mute--off', muted);
  }

  function update(state: SurferState, pocket: HudPocketInfo): void {
    trickEl.textContent = state.activeTrick?.name ?? '';
    trickEl.classList.toggle('hud__trick--active', Boolean(state.activeTrick));

    if (state.barrelTime > 0.2) {
      barrelEl.textContent = `BARREL ${state.barrelTime.toFixed(1)}s`;
      barrelEl.classList.add('hud__barrel--active');
      barrelEl.style.opacity = '';
    } else if (state.barrelFlash > 0 && state.lastBarrelDuration > 0) {
      barrelEl.textContent = `BARREL ${state.lastBarrelDuration.toFixed(1)}s!`;
      barrelEl.classList.add('hud__barrel--active');
      barrelEl.style.opacity = state.barrelFlash.toFixed(2);
    } else {
      barrelEl.textContent = '';
      barrelEl.classList.remove('hud__barrel--active');
      barrelEl.style.opacity = '';
    }

    stokeEl.style.width = `${Math.round(state.stoke * 100)}%`;
    stokeEl.classList.toggle('hud__stoke-fill--surging', state.barrelDepth > 0.3);

    const dx = pocket.x - state.position.x;
    const dz = pocket.z - state.position.z;
    const distance = Math.hypot(dx, dz);
    const showArrow = distance > POCKET_ARROW_HIDE_DISTANCE && state.barrelDepth < 0.25;
    pocketEl.classList.toggle('hud__pocket--visible', showArrow);
    if (showArrow) {
      const bearing = Math.atan2(dx, -dz) - state.heading;
      pocketEl.style.transform = `translate(-50%, -50%) rotate(${((bearing * 180) / Math.PI).toFixed(1)}deg)`;
    }
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
