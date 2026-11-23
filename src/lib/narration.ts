import * as Speech from 'expo-speech';

let muted = false;

// expo-speech queues every utterance, so a fast drive could leave a long
// backlog of stories. Cap the queue so the newest landmark is heard promptly.
const MAX_QUEUED = 2;
let queued = 0;

export function setMuted(value: boolean): void {
  muted = value;
  if (value) {
    queued = 0;
    void Speech.stop();
  }
}

export function isMuted(): boolean {
  return muted;
}

export function stopSpeech(): Promise<void> {
  queued = 0;
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
    queued = 0;
    void Speech.stop();
  }

  queued += 1;
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    queued = Math.max(0, queued - 1);
    onDone?.();
  };

  try {
    Speech.speak(text, {
      language: 'en-US',
      rate: 0.95,
      pitch: 1.0,
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

function trimExtract(extract: string, maxLength = 340): string {
  const clean = extract.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;

  const sentences = clean.split(/(?<=[.!?])\s+/);
  let out = '';
  for (const sentence of sentences) {
    const next = `${out} ${sentence}`.trim();
    if (next.length > maxLength) break;
    out = next;
    if (out.length > 160) break;
  }
  return out || `${clean.slice(0, maxLength).trim()}…`;
}

/** Build the spoken line for a place. */
export function buildScript(
  title: string,
  kind: string,
  extract: string | null,
  isHere = false,
): string {
  const base = isHere ? `You're passing ${title}.` : `Coming up on ${title}.`;
  if (extract && extract.trim()) {
    return `${base} ${trimExtract(extract)}`;
  }
  return `${base} It's ${withArticle(kind)}.`;
}
