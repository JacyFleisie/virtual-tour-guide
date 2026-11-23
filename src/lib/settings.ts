import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Settings {
  muted: boolean;
  autoNarrate: boolean;
  follow: boolean;
  minInterest: number;
}

export const DEFAULT_SETTINGS: Settings = {
  muted: false,
  autoNarrate: true,
  follow: true,
  minInterest: 70,
};

const SETTINGS_KEY = 'tourguide.settings.v1';
const INTRO_KEY = 'tourguide.intro.v1';

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings: Settings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore persistence failures
  }
}

export async function hasSeenIntro(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(INTRO_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function markIntroSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(INTRO_KEY, '1');
  } catch {
    // ignore
  }
}
