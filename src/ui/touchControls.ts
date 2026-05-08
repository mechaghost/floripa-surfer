import { applyPadInput, type InputState } from '../game/input/inputState';
import { clamp } from '../game/simulation/math';

export type TouchControls = {
  root: HTMLElement;
  dispose: () => void;
};

export function createTouchControls(input: InputState): TouchControls {
  const root = document.createElement('div');
  root.className = 'touch';
  root.innerHTML = `
    <div class="touch__pad" data-pad aria-label="Surf control pad" role="application">
      <div class="touch__ring"></div>
      <div class="touch__knob" data-knob></div>
    </div>
    <div class="touch__tricks" aria-label="Jump action">
      <button class="touch__button touch__button--primary" type="button" data-jump aria-label="Jump">↑</button>
    </div>
  `;

  const pad = root.querySelector<HTMLElement>('[data-pad]');
  const knob = root.querySelector<HTMLElement>('[data-knob]');
  const jumpButton = root.querySelector<HTMLButtonElement>('[data-jump]');
  const disposers: Array<() => void> = [];
  let padPointer: number | null = null;

  if (!pad || !knob || !jumpButton) {
    throw new Error('Touch controls failed to initialize');
  }

  const movePad = (clientX: number, clientY: number) => {
    const rect = pad.getBoundingClientRect();
    const radius = rect.width * 0.5;
    const x = clamp((clientX - rect.left - radius) / radius, -1, 1);
    const y = clamp((clientY - rect.top - radius) / radius, -1, 1);
    const magnitude = Math.min(1, Math.hypot(x, y));
    const angle = Math.atan2(y, x);
    const nx = Math.cos(angle) * magnitude;
    const ny = Math.sin(angle) * magnitude;

    applyPadInput(input, nx, ny);
    knob.style.transform = `translate(${nx * 42}px, ${ny * 42}px)`;
  };

  const clearPad = () => {
    input.left = 0;
    input.right = 0;
    input.forward = 0;
    input.back = 0;
    knob.style.transform = 'translate(0, 0)';
    padPointer = null;
  };

  const onPadDown = (event: PointerEvent) => {
    padPointer = event.pointerId;
    capturePointer(pad, event.pointerId);
    movePad(event.clientX, event.clientY);
  };
  const onPadMove = (event: PointerEvent) => {
    if (event.pointerId === padPointer) {
      movePad(event.clientX, event.clientY);
    }
  };
  const onPadUp = (event: PointerEvent) => {
    if (event.pointerId === padPointer) {
      clearPad();
    }
  };

  pad.addEventListener('pointerdown', onPadDown);
  pad.addEventListener('pointermove', onPadMove);
  pad.addEventListener('pointerup', onPadUp);
  pad.addEventListener('pointercancel', onPadUp);
  disposers.push(() => {
    pad.removeEventListener('pointerdown', onPadDown);
    pad.removeEventListener('pointermove', onPadMove);
    pad.removeEventListener('pointerup', onPadUp);
    pad.removeEventListener('pointercancel', onPadUp);
  });

  const setJump = (active: boolean) => {
    input.trick = active;
    input.trickUp = false;
    input.trickDown = false;
    input.trickLeft = false;
    input.trickRight = false;
    jumpButton.classList.toggle('touch__button--active', active);
  };
  const onJumpDown = (event: PointerEvent) => {
    capturePointer(jumpButton, event.pointerId);
    setJump(true);
  };
  const onJumpUp = () => setJump(false);

  jumpButton.addEventListener('pointerdown', onJumpDown);
  jumpButton.addEventListener('pointerup', onJumpUp);
  jumpButton.addEventListener('pointercancel', onJumpUp);
  jumpButton.addEventListener('lostpointercapture', onJumpUp);
  disposers.push(() => {
    jumpButton.removeEventListener('pointerdown', onJumpDown);
    jumpButton.removeEventListener('pointerup', onJumpUp);
    jumpButton.removeEventListener('pointercancel', onJumpUp);
    jumpButton.removeEventListener('lostpointercapture', onJumpUp);
  });

  return {
    root,
    dispose: () => disposers.forEach((dispose) => dispose()),
  };
}

function capturePointer(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Some automation and older mobile browsers dispatch pointer events without
    // an active capture target. Control state still updates without capture.
  }
}
