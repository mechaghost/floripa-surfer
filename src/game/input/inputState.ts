export type InputState = {
  forward: number;
  back: number;
  left: number;
  right: number;
  trick: boolean;
  trickUp: boolean;
  trickDown: boolean;
  trickLeft: boolean;
  trickRight: boolean;
};

export function createInputState(): InputState {
  return {
    forward: 0,
    back: 0,
    left: 0,
    right: 0,
    trick: false,
    trickUp: false,
    trickDown: false,
    trickLeft: false,
    trickRight: false,
  };
}

export function applyPadInput(input: InputState, x: number, y: number): void {
  input.left = Math.max(0, -x);
  input.right = Math.max(0, x);
  input.forward = Math.max(0, -y);
  input.back = Math.max(0, y);
}

export function attachKeyboard(input: InputState): () => void {
  const down = (event: KeyboardEvent) => setKey(input, event, true);
  const up = (event: KeyboardEvent) => setKey(input, event, false);

  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);

  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
  };
}

function setKey(input: InputState, event: KeyboardEvent, active: boolean): void {
  const value = active ? 1 : 0;

  switch (event.code) {
    case 'KeyW':
      input.forward = value;
      break;
    case 'KeyS':
      input.back = value;
      break;
    case 'KeyA':
      input.left = value;
      break;
    case 'KeyD':
      input.right = value;
      break;
    case 'Space':
      input.trick = active;
      event.preventDefault();
      break;
    case 'ArrowUp':
      input.trickUp = active;
      event.preventDefault();
      break;
    case 'ArrowDown':
      input.trickDown = active;
      event.preventDefault();
      break;
    case 'ArrowLeft':
      input.trickLeft = active;
      event.preventDefault();
      break;
    case 'ArrowRight':
      input.trickRight = active;
      event.preventDefault();
      break;
    default:
      break;
  }
}
