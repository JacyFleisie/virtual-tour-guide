import { Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { ingestSample, ingestSamples } from './tourEngine';

export const LOCATION_TASK = 'virtual-tour-guide-location';

export type TrackingMode = 'starting' | 'background' | 'foreground' | 'off';

/**
 * Called by the OS whenever a batch of locations is delivered, whether the app
 * is on screen, backgrounded, or running with the screen locked. It only
 * mutates the shared tour engine, so no React tree is required.
 */
if (Platform.OS !== 'web' && !TaskManager.isTaskDefined(LOCATION_TASK)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
    LOCATION_TASK,
    async ({ data, error }) => {
      if (error) {
        // Nothing to recover here; the next delivery usually succeeds.
        return;
      }
      try {
        await ingestSamples(data?.locations);
      } catch {
        // a failing batch must not crash the headless runtime
      }
    },
  );
}

// 50 m between fixes matches the narration window (a cue opens 300 m+ before a
// place), so it is precise enough for driving while waking the GPS far less
// than a 20 m interval, which saves battery on a long trip.
export const TASK_OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.High,
  distanceInterval: 50,
  timeInterval: 10000,
  activityType: Location.ActivityType.AutomotiveNavigation,
  pausesUpdatesAutomatically: false,
  showsBackgroundLocationIndicator: true,
  foregroundService: {
    notificationTitle: 'Virtual Tour Guide',
    notificationBody: 'Listening for landmarks along your route.',
    notificationColor: '#0b1220',
    killServiceOnDestroy: false,
  },
};

const FOREGROUND_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.High,
  distanceInterval: 50,
  timeInterval: 10000,
  mayShowUserSettingsDialog: true,
};

let foregroundSubscription: Location.LocationSubscription | null = null;

async function stopForegroundWatch(): Promise<void> {
  if (foregroundSubscription) {
    foregroundSubscription.remove();
    foregroundSubscription = null;
  }
}

export interface StartTrackingResult {
  mode: 'background' | 'foreground';
  reason?: string;
}

/**
 * Prefer OS-driven background updates; fall back to a foreground watcher when
 * the platform or the user does not allow background location.
 */
export async function startLocationTracking(): Promise<StartTrackingResult> {
  let reason: string | undefined;

  if (Platform.OS !== 'web') {
    try {
      const supported = await TaskManager.isAvailableAsync();
      if (!supported) {
        reason = 'Background location is not available here. Keep the app open.';
      } else {
        let permission = await Location.getBackgroundPermissionsAsync();
        if (permission.status !== 'granted') {
          permission = await Location.requestBackgroundPermissionsAsync();
        }
        if (permission.status !== 'granted') {
          reason =
            'Background location is off, so the tour pauses when the app is in the background.';
        } else {
          await Location.startLocationUpdatesAsync(LOCATION_TASK, TASK_OPTIONS);
          if (await TaskManager.isTaskRegisteredAsync(LOCATION_TASK)) {
            await stopForegroundWatch();
            return { mode: 'background' };
          }
          reason = 'Background location could not start. Keep the app open.';
        }
      }
    } catch (error) {
      reason =
        (error as Error)?.message ?? 'Background location could not start. Keep the app open.';
    }
  } else {
    reason = 'Background location is not available on the web.';
  }

  await stopForegroundWatch();
  foregroundSubscription = await Location.watchPositionAsync(
    FOREGROUND_OPTIONS,
    (update) => {
      void ingestSample(update.coords);
    },
  );
  return { mode: 'foreground', reason };
}

export async function stopLocationTracking(): Promise<void> {
  await stopForegroundWatch();
  try {
    if (await TaskManager.isTaskRegisteredAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch {
    // already stopped
  }
}

/** True when a background task survived an app restart. */
export async function isBackgroundTrackingRunning(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return await TaskManager.isTaskRegisteredAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

/** Whether the OS currently allows location updates while backgrounded. */
export async function hasBackgroundPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const permission = await Location.getBackgroundPermissionsAsync();
    return permission.status === 'granted';
  } catch {
    return false;
  }
}

/**
 * Ask the OS for "all the time" location access. On Android 11+ this opens the
 * system settings page instead of showing a dialog, so the caller should
 * explain why before calling this and re-check afterwards.
 */
export async function requestBackgroundTracking(): Promise<StartTrackingResult> {
  if (Platform.OS === 'web') {
    return { mode: 'foreground', reason: 'Background location is not available on the web.' };
  }

  try {
    const available = await TaskManager.isAvailableAsync();
    if (!available) {
      return {
        mode: 'foreground',
        reason: 'Background location is not available in this build. Keep the app open.',
      };
    }

    let permission = await Location.getBackgroundPermissionsAsync();
    if (permission.status !== 'granted') {
      permission = await Location.requestBackgroundPermissionsAsync();
    }
    if (permission.status !== 'granted') {
      return {
        mode: 'foreground',
        reason:
          'Background access is still off. Choose "Allow all the time" in settings to keep the tour running with the screen locked.',
      };
    }

    return await startLocationTracking();
  } catch (error) {
    return {
      mode: 'foreground',
      reason: (error as Error)?.message ?? 'Background location could not start.',
    };
  }
}

/** Open this app's system settings page (used to grant location access). */
export function openSystemSettings(): void {
  Linking.openSettings().catch(() => undefined);
}
