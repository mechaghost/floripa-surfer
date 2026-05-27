/**
 * Procedural audio for Floripa Surfer.
 *
 * All sounds are synthesized via Web Audio API — no asset files.
 * - Ocean ambience: filtered noise with slow LFO modulation
 * - Ambient music: slow chord pad cycling through a chill pentatonic progression
 * - SFX: speed-modulated water rush, jump whoosh, landing splash, trick chime,
 *   wipeout splash + thud
 *
 * Audio is started on first user gesture (browser autoplay policy).
 * Mute state persists to localStorage.
 */

import type { InputState } from '../game/input/inputState';
import type { SurferState } from '../game/simulation/surfer';
import type { WaveSample } from '../game/simulation/waves';

const STORAGE_KEY = 'floripa-audio-muted';

export type AudioController = {
  update(state: SurferState, wave: WaveSample, input: InputState, dt: number): void;
  setMuted(muted: boolean): void;
  getMuted(): boolean;
  dispose(): void;
};

type AudioGraph = {
  update(state: SurferState, wave: WaveSample, input: InputState, dt: number): void;
  setMasterMute(muted: boolean): void;
};

export function createAudio(): AudioController {
  const Ctor: typeof AudioContext | undefined =
    (typeof AudioContext !== 'undefined' ? AudioContext : undefined) ??
    ((globalThis as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext);

  let muted = loadMute();
  let ctx: AudioContext | null = null;
  let graph: AudioGraph | null = null;
  let started = false;

  function ensureStarted(): void {
    if (started || !Ctor) {
      return;
    }
    started = true;
    ctx = new Ctor();
    graph = buildGraph(ctx, muted);
  }

  function resumeOnGesture(): void {
    ensureStarted();
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume();
    }
  }

  // The first user gesture (keydown / pointerdown / touchstart) is what
  // satisfies the browser autoplay policy. After that the audio loop runs.
  window.addEventListener('pointerdown', resumeOnGesture, { once: false });
  window.addEventListener('keydown', resumeOnGesture, { once: false });
  window.addEventListener('touchstart', resumeOnGesture, { once: false, passive: true });

  function update(state: SurferState, wave: WaveSample, input: InputState, dt: number): void {
    if (!graph) {
      return;
    }
    graph.update(state, wave, input, dt);
  }

  function setMuted(value: boolean): void {
    muted = value;
    saveMute(muted);
    if (graph) {
      graph.setMasterMute(muted);
    }
  }

  function dispose(): void {
    window.removeEventListener('pointerdown', resumeOnGesture);
    window.removeEventListener('keydown', resumeOnGesture);
    window.removeEventListener('touchstart', resumeOnGesture);
    if (ctx) {
      void ctx.close();
      ctx = null;
    }
    graph = null;
    started = false;
  }

  return {
    update,
    setMuted,
    getMuted: () => muted,
    dispose,
  };
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

function buildGraph(ctx: AudioContext, startMuted: boolean): AudioGraph {
  const master = ctx.createGain();
  master.gain.value = startMuted ? 0 : 0.72;
  master.connect(ctx.destination);

  const ambient = createOceanAmbient(ctx, master);
  const music = createAmbientMusic(ctx, master);
  const sfx = createSfx(ctx, master);

  function update(state: SurferState, wave: WaveSample, input: InputState, dt: number): void {
    const now = ctx.currentTime;
    ambient.update(state, wave, now);
    music.update(now);
    sfx.update(state, wave, input, dt, now);
  }

  function setMasterMute(muted: boolean): void {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.linearRampToValueAtTime(muted ? 0 : 0.72, now + 0.18);
  }

  return { update, setMasterMute };
}

// ---------------------------------------------------------------------------
// Ocean ambience — wide bandpassed noise with a slow LFO
// ---------------------------------------------------------------------------

function createOceanAmbient(ctx: AudioContext, dest: AudioNode) {
  const noise = ctx.createBufferSource();
  noise.buffer = whiteNoiseBuffer(ctx, 3);
  noise.loop = true;

  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 620;
  band.Q.value = 0.55;

  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 2200;

  // Slow LFO modulates the bandpass center so the ambience washes in and out
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.13;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 240;
  lfo.connect(lfoGain);
  lfoGain.connect(band.frequency);

  // A second slower LFO on amplitude for distant-wave feel
  const ampLfo = ctx.createOscillator();
  ampLfo.frequency.value = 0.07;
  const ampLfoGain = ctx.createGain();
  ampLfoGain.gain.value = 0.04;
  const out = ctx.createGain();
  out.gain.value = 0.13;
  ampLfo.connect(ampLfoGain);
  ampLfoGain.connect(out.gain);

  noise.connect(band);
  band.connect(low);
  low.connect(out);
  out.connect(dest);

  noise.start();
  lfo.start();
  ampLfo.start();

  function update(state: SurferState, wave: WaveSample, now: number): void {
    // Push the ambience up when the player is on a powerful wave face
    const target = 0.1 + Math.min(0.16, state.speed * 0.008 + wave.facePower * 0.08);
    out.gain.cancelScheduledValues(now);
    out.gain.linearRampToValueAtTime(target, now + 0.25);
  }

  return { update };
}

// ---------------------------------------------------------------------------
// Ambient music — slow chord pad cycling through a pentatonic-friendly set.
// Two detuned sine voices per chord note for a wide, washy pad.
// ---------------------------------------------------------------------------

function createAmbientMusic(ctx: AudioContext, dest: AudioNode) {
  const out = ctx.createGain();
  out.gain.value = 0.06;
  out.connect(dest);

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 1500;
  lowpass.Q.value = 0.4;
  lowpass.connect(out);

  // A minor pentatonic-leaning progression: Am, F, C, G
  // Voiced at A3/C4/E4 etc — low enough to sit under SFX
  const chords: number[][] = [
    [220.0, 261.63, 329.63], // Am
    [174.61, 220.0, 261.63], // F
    [261.63, 329.63, 392.0], // C
    [196.0, 246.94, 293.66], // G
  ];

  const chordDuration = 11; // seconds — slow, contemplative
  const fadeIn = 2.4;
  const fadeOut = 2.8;
  let chordIndex = 0;
  let nextChordAt = -1;

  function scheduleChord(startTime: number, chord: number[]): void {
    for (const freq of chord) {
      // Two detuned sines per note → gentle chorus
      for (const detune of [-6, 6]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.detune.value = detune;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.18, startTime + fadeIn);
        gain.gain.setValueAtTime(0.18, startTime + chordDuration - fadeOut);
        gain.gain.linearRampToValueAtTime(0, startTime + chordDuration);
        osc.connect(gain);
        gain.connect(lowpass);
        osc.start(startTime);
        osc.stop(startTime + chordDuration + 0.1);
      }
    }
  }

  function update(now: number): void {
    if (nextChordAt < 0) {
      nextChordAt = now + 0.8; // brief delay before the first chord
    }
    if (now >= nextChordAt - 0.05) {
      scheduleChord(nextChordAt, chords[chordIndex]);
      chordIndex = (chordIndex + 1) % chords.length;
      // Crossfade: schedule next chord slightly before the current ends
      nextChordAt += chordDuration - fadeOut * 0.5;
    }
  }

  return { update };
}

// ---------------------------------------------------------------------------
// SFX — continuous water rush + one-shot whoosh / splash / chime / thud
// ---------------------------------------------------------------------------

type SfxState = {
  update(state: SurferState, wave: WaveSample, input: InputState, dt: number, now: number): void;
};

function createSfx(ctx: AudioContext, dest: AudioNode): SfxState {
  const out = ctx.createGain();
  out.gain.value = 0.5;
  out.connect(dest);

  // Continuous "water rushing past board" — speed + carve modulated
  const rush = ctx.createBufferSource();
  rush.buffer = whiteNoiseBuffer(ctx, 2);
  rush.loop = true;
  const rushBand = ctx.createBiquadFilter();
  rushBand.type = 'bandpass';
  rushBand.frequency.value = 700;
  rushBand.Q.value = 0.45;
  const rushGain = ctx.createGain();
  rushGain.gain.value = 0;
  rush.connect(rushBand);
  rushBand.connect(rushGain);
  rushGain.connect(out);
  rush.start();

  // Event detection state
  let prevAirtime = 0;
  let prevTrickActive = false;
  let prevScore = 0;
  let prevWipeoutTimer = 0;
  let wipeoutFired = false;

  function playSplash(intensity: number, now: number): void {
    const duration = 0.45 + intensity * 0.25;
    const src = ctx.createBufferSource();
    src.buffer = noiseBurstBuffer(ctx, duration, 5 + intensity * 2);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 600 - intensity * 200;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3800 + intensity * 1800, now);
    lp.frequency.exponentialRampToValueAtTime(1200, now + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35 + intensity * 0.35, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    src.connect(hp);
    hp.connect(lp);
    lp.connect(g);
    g.connect(out);
    src.start(now);
    src.stop(now + duration + 0.05);
  }

  function playThud(intensity: number, now: number): void {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(95, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.55 * intensity, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(g);
    g.connect(out);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  function playWhoosh(now: number): void {
    const duration = 0.34;
    const src = ctx.createBufferSource();
    src.buffer = noiseBurstBuffer(ctx, duration, 3.5);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(380, now);
    bp.frequency.exponentialRampToValueAtTime(2400, now + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    src.connect(bp);
    bp.connect(g);
    g.connect(out);
    src.start(now);
    src.stop(now + duration + 0.05);
  }

  function playChime(now: number): void {
    // Bright major-third double note — A5 + C#6
    const notes = [880.0, 1108.73];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const start = now + i * 0.04;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.18, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.55);
      osc.connect(g);
      g.connect(out);
      osc.start(start);
      osc.stop(start + 0.6);
    });
  }

  function update(state: SurferState, _wave: WaveSample, input: InputState, _dt: number, now: number): void {
    // Continuous water rush — louder with speed and carving
    const speedNorm = Math.min(1, state.speed / 18);
    const carve = Math.abs(input.right - input.left);
    const targetGain = 0.04 + speedNorm * 0.16 + carve * 0.18;
    const targetFreq = 480 + speedNorm * 520 + carve * 700;
    rushGain.gain.cancelScheduledValues(now);
    rushGain.gain.linearRampToValueAtTime(targetGain, now + 0.1);
    rushBand.frequency.cancelScheduledValues(now);
    rushBand.frequency.linearRampToValueAtTime(targetFreq, now + 0.1);

    // Jump start: trick becomes active and the surfer leaves the water
    const trickActive = state.activeTrick !== null;
    const justJumped = trickActive && !prevTrickActive && state.verticalVelocity > 0.1;
    if (justJumped) {
      playWhoosh(now);
    }

    // Landing: was airborne, now grounded
    if (prevAirtime > 0.05 && state.airtime === 0) {
      const landingIntensity = Math.min(1, prevAirtime * 0.85);
      playSplash(landingIntensity, now);
    }

    // Trick scored: a noticeable score jump while a trick just completed
    const scoreDelta = state.score - prevScore;
    if (scoreDelta > 60 && prevTrickActive && !trickActive) {
      playChime(now);
    }

    // Wipeout: timer crossed a threshold this frame
    if (state.wipeoutTimer > 1.2 && prevWipeoutTimer <= 1.2 && !wipeoutFired) {
      playSplash(1, now);
      playThud(0.85, now);
      wipeoutFired = true;
    }
    if (state.wipeoutTimer < 0.4 && wipeoutFired) {
      wipeoutFired = false; // re-arm once we're clearly back in the pocket
    }

    prevAirtime = state.airtime;
    prevTrickActive = trickActive;
    prevScore = state.score;
    prevWipeoutTimer = state.wipeoutTimer;
  }

  return { update };
}

// ---------------------------------------------------------------------------
// Buffer helpers
// ---------------------------------------------------------------------------

function whiteNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const channels = 2;
  const buffer = ctx.createBuffer(channels, ctx.sampleRate * seconds, ctx.sampleRate);
  for (let ch = 0; ch < channels; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
  }
  return buffer;
}

function noiseBurstBuffer(ctx: AudioContext, seconds: number, decayShape: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    const env = Math.exp((-i / length) * decayShape);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  return buffer;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function loadMute(): boolean {
  if (typeof localStorage === 'undefined') {
    return false;
  }
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveMute(muted: boolean): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
  } catch {
    /* localStorage may be unavailable (private browsing on Safari etc.) */
  }
}
