import * as Location from 'expo-location';
import { GeoPosition, LatLng, NarrationCard, Poi } from '../types';
import { fetchNearbyPois } from './overpass';
import { fetchWikipediaPois } from './wikipediaGeo';
import { fetchSummary } from './wiki';
import { buildScript, setMuted, speak } from './narration';
import {
  getCachedPoi,
  initDb,
  markNarrated,
  putCachedPoi,
  wasNarratedRecently,
} from './db';
import { haversine } from './geo';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, Settings } from './settings';

const FETCH_RADIUS = 700;
const MAX_FETCH_RADIUS = 2500;
const MIN_MOVE_FETCH = 200;
const MIN_FETCH_INTERVAL = 25000;
const MAX_TRAIL = 300;
const MAX_POIS = 80;

// Narration should lead the landmark, not trail it. At speed the lead distance
// grows so the story starts the same number of seconds before the pass, which
// is what makes it work on a motorway as well as in town.
const CUE_BASE_METERS = 260;
const CUE_SECONDS = 22;
const MAX_CUE_METERS = 1200;
// Anything this far off the nose is considered already behind us.
const BEHIND_DEGREES = 100;

export interface TourState {
  position: GeoPosition | null;
  trail: LatLng[];
  pois: Poi[];
  nowPlaying: NarrationCard | null;
  fetching: boolean;
}

let state: TourState = {
  position: null,
  trail: [],
  pois: [],
  nowPlaying: null,
  fetching: false,
};

const listeners = new Set<(state: TourState) => void>();

function setState(patch: Partial<TourState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) {
    try {
      listener(state);
    } catch {
      // a broken subscriber must not stop tracking
    }
  }
}

export function getTourState(): TourState {
  return state;
}

/**
 * The tour engine lives at module scope so the background location task and the
 * React screen share one stream of samples, places and narration.
 */
export function subscribeTour(listener: (state: TourState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

let settings: Settings = DEFAULT_SETTINGS;
let settingsReady: Promise<Settings> | null = null;
let dbReady: Promise<void> | null = null;

export function getSettings(): Settings {
  return settings;
}

/** Load persisted settings and open the cache; safe to call repeatedly. */
export function ensureEngineReady(): Promise<Settings> {
  if (!dbReady) {
    dbReady = initDb().catch(() => undefined);
  }
  if (!settingsReady) {
    settingsReady = (async () => {
      const loaded = await loadSettings();
      settings = loaded;
      setMuted(loaded.muted);
      return settings;
    })();
  }
  return settingsReady;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  settings = { ...settings, ...patch };
  void saveSettings(settings);
  if (patch.muted !== undefined) setMuted(!!patch.muted);
  return settings;
}

const inFlight = new Set<string>();
let lastCard: NarrationCard | null = null;
// Narration now starts on every fix that brings a place into cue range, so a
// short cooldown keeps one story from being cut off by the next landmark.
const NARRATE_COOLDOWN_MS = 18000;
let lastNarrateAt = 0;

export async function narratePoi(poi: Poi): Promise<void> {
  if (inFlight.has(poi.id)) return;
  inFlight.add(poi.id);
  try {
    const cached = await getCachedPoi(poi.id).catch(() => null);
    let title = poi.name;
    let extract = cached?.summary ?? null;
    let image = cached?.image ?? null;

    if (!extract) {
      const summary = await fetchSummary(poi);
      if (summary) {
        title = summary.title || poi.name;
        extract = summary.extract;
        image = summary.image;
        await putCachedPoi({
          id: poi.id,
          name: poi.name,
          kind: poi.kind,
          lat: poi.lat,
          lng: poi.lng,
          summary: summary.extract,
          image: summary.image,
          title: summary.title,
          fetched_at: Date.now(),
        }).catch(() => undefined);
      }
    }

    const from = state.position;
    const isHere = from
      ? haversine(from.lat, from.lng, poi.lat, poi.lng) < 150
      : true;
    const text = buildScript(title, poi.kind, extract, isHere);
    const card: NarrationCard = {
      poiId: poi.id,
      title,
      kind: poi.kind,
      text,
      image,
      at: Date.now(),
    };
    lastCard = card;
    lastNarrateAt = Date.now();
    setState({ nowPlaying: card });
    if (!settings.muted) speak(text);

    const at = state.position;
    await markNarrated(poi.id, at?.lat ?? poi.lat, at?.lng ?? poi.lng).catch(
      () => undefined,
    );
  } catch {
    // ignore individual failures
  } finally {
    setTimeout(() => {
      inFlight.delete(poi.id);
    }, 4000);
  }
}

/** How far ahead of the driver to start a story, in metres. */
function cueDistance(speed: number | null): number {
  const mps = Math.max(0, speed ?? 0);
  const lead = mps * CUE_SECONDS + CUE_BASE_METERS;
  return Math.min(MAX_CUE_METERS, Math.max(CUE_BASE_METERS, lead));
}

/** Keep places far enough ahead in the list when the cue window is wide. */
function fetchRadius(speed: number | null): number {
  return Math.min(
    MAX_FETCH_RADIUS,
    Math.max(FETCH_RADIUS, Math.round(cueDistance(speed) + 300)),
  );
}

/** Initial bearing from one point to another, in degrees clockwise from north. */
function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const from = lat1 * rad;
  const to = lat2 * rad;
  const dLng = (lng2 - lng1) * rad;
  const y = Math.sin(dLng) * Math.cos(to);
  const x =
    Math.cos(from) * Math.sin(to) - Math.sin(from) * Math.cos(to) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Smallest angle between two headings, 0-180 degrees. */
function angleGap(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

let autoNarrateBusy = false;

async function autoNarrate(position: GeoPosition, list: Poi[]): Promise<void> {
  if (!settings.autoNarrate || settings.muted) return;
  // A fix publishes twice (Wikipedia, then OSM). The second pass must not skip
  // past the story already in `inFlight` and start a competing one.
  if (autoNarrateBusy || inFlight.size > 0) return;
  if (Date.now() - lastNarrateAt < NARRATE_COOLDOWN_MS) return;
  autoNarrateBusy = true;
  try {
    await narrateBestCandidate(position, list);
  } finally {
    autoNarrateBusy = false;
  }
}

async function narrateBestCandidate(
  position: GeoPosition,
  list: Poi[],
): Promise<void> {
  const { lat, lng } = position;
  const cue = cueDistance(position.speed);
  // Heading is only trustworthy while actually moving; at a red light it can
  // be stale, so the forward filter is applied on the move only.
  const moving = (position.speed ?? 0) > 1.5;
  const nose = position.heading;

  const candidates = list
    .map((poi) => ({ poi, distance: haversine(lat, lng, poi.lat, poi.lng) }))
    .filter((item) => item.distance <= cue)
    .filter((item) => item.poi.interest >= settings.minInterest)
    .filter((item) => {
      // A place the nose points away from is one we have already passed.
      if (!moving || nose === null) return true;
      const offNose = angleGap(
        bearing(lat, lng, item.poi.lat, item.poi.lng),
        nose,
      );
      return offNose <= BEHIND_DEGREES;
    })
    // Nearest first: the cue window is wide at speed, so announce the place we
    // reach soonest rather than the most interesting one further up the road.
    .sort((a, b) => a.distance - b.distance || b.poi.interest - a.poi.interest);

  for (const candidate of candidates) {
    const skip = await wasNarratedRecently(candidate.poi.id, lat, lng).catch(
      () => false,
    );
    if (skip) continue;
    void narratePoi(candidate.poi);
    break;
  }
}

let lastFetch: { lat: number; lng: number; at: number } | null = null;

/** Overpass can hang; cap how long its pass stays open. */
const FETCH_DEADLINE = 12000;

function timeout(ms: number): Promise<Poi[]> {
  return new Promise((resolve) => setTimeout(() => resolve([]), ms));
}

function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
}

function publishPois(lat: number, lng: number, incoming: Poi[]): void {
  const merged = new Map<string, Poi>();
  for (const poi of state.pois) merged.set(poi.id, poi);
  for (const poi of incoming) merged.set(poi.id, poi);

  // The same landmark can come from OSM and Wikipedia; keep one pin, by name.
  const unique = new Map<string, Poi>();
  for (const poi of merged.values()) {
    const key = nameKey(poi.name);
    const existing = unique.get(key);
    if (!existing || poi.interest > existing.interest) unique.set(key, poi);
  }

  const keepRadius = fetchRadius(state.position?.speed ?? null) * 1.4;
  const list = Array.from(unique.values())
    .filter((poi) => haversine(lat, lng, poi.lat, poi.lng) <= keepRadius)
    .sort(
      (a, b) => haversine(lat, lng, a.lat, a.lng) - haversine(lat, lng, b.lat, b.lng),
    )
    .slice(0, MAX_POIS);

  setState({ pois: list });
  const from = state.position;
  if (from) void autoNarrate(from, list);
}

let fetchSeq = 0;

/**
 * Wikipedia geosearch is fast, Overpass can take up to the whole deadline, so
 * the two are published independently: the map fills from Wikipedia at once
 * and OSM pins merge in when (and if) that source answers.
 */
async function runFetch(lat: number, lng: number, radius: number): Promise<void> {
  const seq = ++fetchSeq;
  // publishPois filters around the coordinates it is handed, so a pass that a
  // newer fix has superseded must not add pins around the old position.
  const publish = (incoming: Poi[]) => {
    if (seq === fetchSeq) publishPois(lat, lng, incoming);
  };

  setState({ fetching: true });

  // Rejections are swallowed by allSettled: a dead source simply never publishes.
  await Promise.allSettled([
    fetchWikipediaPois(lat, lng, radius).then(publish),
    Promise.race([
      fetchNearbyPois(lat, lng, radius),
      timeout(FETCH_DEADLINE),
    ]).then(publish),
  ]);

  if (seq === fetchSeq) setState({ fetching: false });
}

/**
 * Feed one location fix into the tour. Works identically from the foreground
 * watcher and from the background task (including when no UI is mounted).
 */
export async function ingestSample(coords: Location.LocationObjectCoords): Promise<void> {
  try {
    const heading =
      typeof coords.heading === 'number' && coords.heading >= 0 ? coords.heading : null;
    const speed =
      typeof coords.speed === 'number' && coords.speed >= 0 ? coords.speed : null;
    const accuracy = typeof coords.accuracy === 'number' ? coords.accuracy : null;

    const next: GeoPosition = {
      lat: coords.latitude,
      lng: coords.longitude,
      heading,
      speed,
      accuracy,
    };
    setState({ position: next });

    const trail = state.trail;
    const lastPoint = trail[trail.length - 1];
    if (!lastPoint || haversine(lastPoint.lat, lastPoint.lng, next.lat, next.lng) >= 12) {
      setState({ trail: [...trail, { lat: next.lat, lng: next.lng }].slice(-MAX_TRAIL) });
    }

    // Announce on the way in, not only when a fetch happens to publish: a fix
    // is the moment that actually tells us the driver has moved closer.
    void autoNarrate(next, state.pois);

    const now = Date.now();
    const moved = lastFetch
      ? haversine(lastFetch.lat, lastFetch.lng, next.lat, next.lng)
      : Infinity;
    const elapsed = lastFetch ? now - lastFetch.at : Infinity;
    if (!lastFetch || moved >= MIN_MOVE_FETCH || elapsed >= MIN_FETCH_INTERVAL) {
      lastFetch = { lat: next.lat, lng: next.lng, at: now };
      void runFetch(next.lat, next.lng, fetchRadius(next.speed));
    }
  } catch {
    // a malformed fix must not break the task
  }
}

export async function ingestSamples(
  locations: Location.LocationObject[] | undefined,
): Promise<void> {
  for (const location of locations ?? []) {
    await ingestSample(location.coords);
  }
}

export function tellMeNearest(): { poi: Poi | null; message: string } {
  const current = state.position;
  if (!current) {
    return { poi: null, message: 'Waiting for your location…' };
  }
  if (state.pois.length === 0) {
    return {
      poi: null,
      message: 'No landmarks found nearby yet. Keep driving and I will look again.',
    };
  }
  const sorted = state.pois
    .map((poi) => ({
      poi,
      distance: haversine(current.lat, current.lng, poi.lat, poi.lng),
    }))
    .sort((a, b) => a.distance - b.distance);
  const best = sorted.find((item) => item.distance <= 2500) ?? sorted[0];
  void narratePoi(best.poi);
  return { poi: best.poi, message: `Telling you about ${best.poi.name}` };
}

export function repeatLast(): { ok: boolean; message: string } {
  if (!lastCard) {
    return { ok: false, message: 'Nothing to repeat yet.' };
  }
  if (!settings.muted) speak(lastCard.text);
  return { ok: true, message: 'Repeating the last story.' };
}
