import { applyPadInput, type InputState } from '../game/input/inputState';
import { clamp } from '../game/simulation/math';

export type TouchControls = {
  root: HTMLElement;
  dispose: () => void;
};

export function createTouchControls(input: InputState): TouchControls {
  const root = document.createElement('div');
  root.className = 'touch';
  root.setAttribute('aria-label', 'Surf controls. Drag to carve, tap to jump.');
  root.innerHTML = `
    <div class="touch__pad" data-pad aria-label="Surf control pad" role="application">
      <div class="touch__ring"></div>
      <div class="touch__knob" data-knob></div>
    </div>
    <div class="touch__tap" data-tap></div>
  `;

  const pad = root.querySelector<HTMLElement>('[data-pad]');
  const knob = root.querySelector<HTMLElement>('[data-knob]');
  const tapFlash = root.querySelector<HTMLElement>('[data-tap]');
  const disposers: Array<() => void> = [];
  const dragThreshold = 9;
  const stickRadius = 76;
  let activePointer: number | null = null;
  let originX = 0;
  let originY = 0;
  let lastX = 0;
  let lastY = 0;
  let isDragging = false;
  let jumpTimer: number | null = null;

  if (!pad || !knob || !tapFlash) {
    throw new Error('Touch controls failed to initialize');
  }

  const movePad = (clientX: number, clientY: number) => {
    const x = clamp((clientX - originX) / stickRadius, -1, 1);
    const y = clamp((clientY - originY) / stickRadius, -1, 1);
    const magnitude = Math.min(1, Math.hypot(x, y));
    const angle = Math.atan2(y, x);
    const nx = Math.cos(angle) * magnitude;
    const ny = Math.sin(angle) * magnitude;

    applyPadInput(input, nx, ny);
    knob.style.transform = `translate(${nx * 48}px, ${ny * 48}px)`;
  };

  const showPad = () => {
    pad.style.left = `${originX}px`;
    pad.style.top = `${originY}px`;
    pad.classList.add('touch__pad--active');
  };

  const clearPad = () => {
    input.left = 0;
    input.right = 0;
    input.forward = 0;
    input.back = 0;
    knob.style.transform = 'translate(0, 0)';
    pad.classList.remove('touch__pad--active');
    activePointer = null;
    isDragging = false;
  };

  const triggerJump = (clientX: number, clientY: number) => {
    input.trick = true;
    input.trickUp = false;
    input.trickDown = false;
    input.trickLeft = false;
    input.trickRight = false;
    tapFlash.style.left = `${clientX}px`;
    tapFlash.style.top = `${clientY}px`;
    tapFlash.classList.remove('touch__tap--active');
    tapFlash.offsetWidth;
    tapFlash.classList.add('touch__tap--active');

    if (jumpTimer !== null) {
      window.clearTimeout(jumpTimer);
    }
    jumpTimer = window.setTimeout(() => {
      input.trick = false;
      jumpTimer = null;
    }, 150);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (activePointer !== null) {
      return;
    }

    activePointer = event.pointerId;
    originX = event.clientX;
    originY = event.clientY;
    lastX = event.clientX;
    lastY = event.clientY;
    isDragging = false;
    capturePointer(root, event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== activePointer) {
      return;
    }

    lastX = event.clientX;
    lastY = event.clientY;
    const distance = Math.hypot(lastX - originX, lastY - originY);
    if (!isDragging && distance >= dragThreshold) {
      isDragging = true;
      showPad();
    }

    if (isDragging) {
      movePad(lastX, lastY);
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== activePointer) {
      return;
    }

    const distance = Math.hypot(lastX - originX, lastY - originY);
    if (!isDragging && distance < dragThreshold) {
      triggerJump(event.clientX, event.clientY);
    }
    clearPad();
  };

  const onPointerCancel = (event: PointerEvent) => {
    if (event.pointerId === activePointer) {
      clearPad();
    }
  };

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerCancel);
  root.addEventListener('lostpointercapture', onPointerCancel);
  disposers.push(() => {
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerUp);
    root.removeEventListener('pointercancel', onPointerCancel);
    root.removeEventListener('lostpointercapture', onPointerCancel);
    if (jumpTimer !== null) {
      window.clearTimeout(jumpTimer);
    }
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
