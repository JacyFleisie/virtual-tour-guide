import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import * as Location from 'expo-location';
import { Poi, PoiWithDistance } from '../types';
import { haversine } from '../lib/geo';
import { Settings } from '../lib/settings';
import {
  ensureEngineReady,
  getSettings,
  getTourState,
  ingestSample,
  narratePoi,
  repeatLast as engineRepeatLast,
  skipCurrent as engineSkipCurrent,
  subscribeTour,
  tellMeNearest as engineTellMeNearest,
  TourState,
  updateSettings as engineUpdateSettings,
} from '../lib/tourEngine';
import {
  hasBackgroundPermission,
  openSystemSettings,
  requestBackgroundTracking,
  startLocationTracking,
  TrackingMode,
} from '../lib/backgroundLocation';

type PermissionState = 'unknown' | 'granted' | 'denied';

export function useTourGuide() {
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [tracking, setTracking] = useState<TrackingMode>('starting');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tour, setTour] = useState<TourState>(getTourState());
  const [settings, setSettings] = useState<Settings>(getSettings());

  const aliveRef = useRef(true);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  // The engine is shared with the background task, so narration and places
  // keep flowing even while no screen is mounted.
  useEffect(() => subscribeTour(setTour), []);

  const flash = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => {
      if (aliveRef.current) setNotice(null);
    }, 6000);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const loaded = await ensureEngineReady();
      if (cancelled) return;
      setSettings(loaded);

      try {
        const request = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (request.status !== 'granted') {
          setPermission('denied');
          setTracking('off');
          setError('Location permission is required to find landmarks around you.');
          return;
        }
        setPermission('granted');

        const started = await startLocationTracking();
        if (cancelled) return;
        setTracking(started.mode);
        if (started.reason) flash(started.reason);

        // Show something on the map immediately instead of waiting for the
        // first task delivery. These extra fixes are deduped by the engine's
        // distance and time throttles.
        const lastKnown = await Location.getLastKnownPositionAsync({
          maxAge: 120000,
          requiredAccuracy: 2000,
        }).catch(() => null);
        if (lastKnown && !cancelled) void ingestSample(lastKnown.coords);

        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }).catch(() => null);
        if (current && !cancelled) void ingestSample(current.coords);
      } catch (err) {
        if (!cancelled) {
          setError((err as Error)?.message ?? 'Could not start location tracking.');
          setTracking('off');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [flash]);

  // If the driver grants "all the time" access in system settings and comes
  // back, upgrade the running foreground watcher without a restart.
  useEffect(() => {
    if (tracking !== 'foreground') return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void (async () => {
        if (!(await hasBackgroundPermission())) return;
        const started = await startLocationTracking();
        if (aliveRef.current) {
          setTracking(started.mode);
          if (started.reason) flash(started.reason);
        }
      })();
    });
    return () => subscription.remove();
  }, [tracking, flash]);

  /** Explain, then send the user to the OS prompt/settings for background access. */
  const enableBackgroundTracking = useCallback(() => {
    Alert.alert(
      'Keep the tour running',
      'To narrate landmarks while the screen is locked, Android needs “Allow all the time” location access for this app. The next screen opens your settings.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Continue',
          onPress: () => {
            void (async () => {
              const result = await requestBackgroundTracking();
              if (!aliveRef.current) return;
              setTracking(result.mode);
              if (result.reason) flash(result.reason);
              if (result.mode === 'background') {
                flash('Background tracking is on. You can lock the screen.');
              }
            })();
          },
        },
      ],
    );
  }, [flash]);

  const persist = useCallback((patch: Partial<Settings>) => {
    setSettings(engineUpdateSettings(patch));
  }, []);

  const narrate = useCallback((poi: Poi) => narratePoi(poi), []);

  const tellMeNearest = useCallback(() => {
    const result = engineTellMeNearest();
    if (result.message) flash(result.message);
  }, [flash]);

  const repeatLast = useCallback(() => {
    const result = engineRepeatLast();
    if (!result.ok) flash(result.message);
  }, [flash]);

  const skipStory = useCallback(() => {
    const result = engineSkipCurrent();
    if (!result.ok) flash(result.message);
  }, [flash]);

  const toggleMute = useCallback(() => {
    persist({ muted: !getSettings().muted });
  }, [persist]);

  const toggleAuto = useCallback(() => {
    persist({ autoNarrate: !getSettings().autoNarrate });
  }, [persist]);

  const toggleFollow = useCallback(() => {
    persist({ follow: !getSettings().follow });
  }, [persist]);

  const nearby = useMemo<PoiWithDistance[]>(() => {
    const { position, pois } = tour;
    if (!position) {
      return pois.map((poi) => ({ ...poi, distance: Infinity }));
    }
    return pois
      .map((poi) => ({
        ...poi,
        distance: haversine(position.lat, position.lng, poi.lat, poi.lng),
      }))
      .sort((a, b) => a.distance - b.distance);
  }, [tour]);

  return {
    permission,
    tracking,
    error,
    notice,
    position: tour.position,
    trail: tour.trail,
    pois: tour.pois,
    nearby,
    nowPlaying: tour.nowPlaying,
    settings,
    fetching: tour.fetching,
    narrate,
    tellMeNearest,
    repeatLast,
    skipStory,
    toggleMute,
    toggleAuto,
    toggleFollow,
    enableBackgroundTracking,
    openSettings: openSystemSettings,
  };
}
