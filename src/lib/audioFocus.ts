import { requireNativeModule } from 'expo-modules-core';

interface AudioFocusNativeModule {
  request(): boolean;
  abandon(): void;
}

let native: AudioFocusNativeModule | null = null;
try {
  native = requireNativeModule<AudioFocusNativeModule>('AudioFocus');
} catch {
  // iOS and Expo Go have no copy of the Android module (and Expo Go cannot
  // load it at all); narration simply plays without pausing other apps' music.
  native = null;
}

/** Take audio focus so music pauses under the narration. */
export function holdAudioFocus(): void {
  try {
    native?.request();
  } catch {
    // focus is a courtesy: never let it break a story
  }
}

/** Give the focus back so the paused music can resume. */
export function releaseAudioFocus(): void {
  try {
    native?.abandon();
  } catch {
    // ignore
  }
}
