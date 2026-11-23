import * as Speech from 'expo-speech';

let muted = false;
let speaking = false;

// One story at a time: a driving cue must start promptly, never behind a queue
// of older landmarks, so a second utterance replaces the first.
const MAX_QUEUED = 1;
let queued = 0;
// Bumped whenever the queue is cleared, so callbacks from a stopped utterance
// cannot decrement the count of the one that replaced it.
let generation = 0;

// Slightly under normal speed: clearer in a noisy car, and the story still
// finishes in about the time the lead distance buys.
const RATE = 0.92;
const PITCH = 1.0;
const VOLUME = 1.0;

interface VoiceLike {
  identifier: string;
  name: string;
  language: string;
  quality?: string;
}

let voice: VoiceLike | null = null;
let voiceLookup: Promise<void> | null = null;

function scoreVoice(candidate: VoiceLike): number {
  const language = (candidate.language ?? '').toLowerCase().replace('_', '-');
  if (!language.startsWith('en')) return -1;

  let score = 5;
  if (language.startsWith('en-us')) score += 3;
  else if (language.startsWith('en-gb')) score += 2;

  // Enhanced voices are the noticeably clearer ones; network voices on Android
  // (Google TTS) sound better than the stock local engine too.
  if (String(candidate.quality ?? '').toLowerCase().includes('enhanced')) score += 10;
  const id = `${candidate.identifier ?? ''} ${candidate.name ?? ''}`.toLowerCase();
  if (/network|google/.test(id)) score += 6;
  if (/female|samantha|aria|jenny|zira|kendra/.test(id)) score += 2;

  return score;
}

/**
 * Choose the clearest installed English voice once per app run. Failure is
 * harmless: speak() falls back to the system default for the language.
 */
export function prepareVoice(): Promise<void> {
  if (!voiceLookup) {
    voiceLookup = (async () => {
      try {
        const voices = (await Speech.getAvailableVoicesAsync()) as VoiceLike[];
        const best = (voices ?? [])
          .map((candidate) => ({ candidate, score: scoreVoice(candidate) }))
          .filter((item) => item.score >= 0)
          .sort((a, b) => b.score - a.score)[0];
        voice = best?.candidate ?? null;
      } catch {
        voice = null;
      }
    })();
  }
  return voiceLookup;
}

export function setMuted(value: boolean): void {
  muted = value;
  if (value) {
    generation += 1;
    queued = 0;
    speaking = false;
    void Speech.stop();
  }
}

export function isMuted(): boolean {
  return muted;
}

/** True while a story is still being read aloud. */
export function isSpeaking(): boolean {
  return speaking;
}

export function stopSpeech(): Promise<void> {
  generation += 1;
  queued = 0;
  speaking = false;
  return Speech.stop().catch(() => undefined);
}

export function speak(text: string, onDone?: () => void): void {
  if (muted || !text.trim()) {
    onDone?.();
    return;
  }

  if (queued >= MAX_QUEUED) {
    // Drop what is still waiting (and the current sentence) in favour of the
    // place the driver is passing right now.
    generation += 1;
    queued = 0;
    void Speech.stop();
  }

  queued += 1;
  speaking = true;
  const mine = generation;
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    if (mine !== generation) return;
    queued = Math.max(0, queued - 1);
    if (queued === 0) speaking = false;
    onDone?.();
  };

  try {
    Speech.speak(text, {
      language: voice?.language ?? 'en-US',
      ...(voice ? { voice: voice.identifier } : {}),
      rate: RATE,
      pitch: PITCH,
      volume: VOLUME,
      onDone: done,
      onStopped: done,
      onError: done,
    });
  } catch {
    done();
  }
}

function withArticle(kind: string): string {
  return /^[aeiou]/i.test(kind) ? `an ${kind}` : `a ${kind}`;
}

/** Strip the bits a speech engine reads badly: citations, asides, symbols. */
function cleanForSpeech(extract: string): string {
  return extract
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^()]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Keep the story to a couple of sentences (~18 s of speech). Anything longer
 * gets cut off by the next landmark, so the short version is what is heard.
 */
function trimExtract(extract: string, maxLength = 300): string {
  const clean = cleanForSpeech(extract);
  if (clean.length <= maxLength) return clean;

  const sentences = clean.split(/(?<=[.!?])\s+/);
  let out = '';
  for (const sentence of sentences) {
    const next = `${out} ${sentence}`.trim();
    if (next.length > maxLength) break;
    out = next;
    if (out.length > 140) break;
  }
  if (out) return out;
  // A single long sentence: cut at a word boundary rather than mid-word.
  return clean.slice(0, maxLength).replace(/\s+\S*$/, '').trim();
}

function spokenLead(meters: number): string {
  if (meters < 950) {
    const rounded = Math.max(50, Math.round(meters / 50) * 50);
    return `${rounded} metres ahead`;
  }
  return `${(meters / 1000).toFixed(1)} kilometres ahead`;
}

/** Build the spoken line for a place. */
export function buildScript(
  title: string,
  kind: string,
  extract: string | null,
  lead: number | null = null,
): string {
  let base: string;
  if (lead === null) base = `Coming up on ${title}.`;
  else if (lead < 60) base = `You're passing ${title}.`;
  else base = `${title}, ${spokenLead(lead)}.`;

  if (extract && extract.trim()) {
    return `${base} ${trimExtract(extract)}`;
  }
  return `${base} It's ${withArticle(kind)}.`;
}
