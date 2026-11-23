import * as Location from 'expo-location';
import { GeoPosition, LatLng, NarrationCard, Poi } from '../types';
import { fetchNearbyPois } from './overpass';
import { fetchWikipediaPois } from './wikipediaGeo';
import { fetchSummary } from './wiki';
import { buildScript, isSpeaking, prepareVoice, setMuted, speak } from './narration';
import {
  getCachedPoi,
  initDb,
  markNarrated,
  putCachedPoi,
  wasNarratedRecently,
} from './db';
import { haversine } from './geo';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, Settings } from './settings';

// A drive needs a longer view down the road than a stroll: at 100 km/h the car
// covers 1 km in 36 s, so places are fetched a kilometre out and kept until the
// driver is well past them.
const FETCH_RADIUS = 1000;
const MAX_FETCH_RADIUS = 3000;
const MIN_MOVE_FETCH = 250;
const MIN_FETCH_INTERVAL = 30000;
const MAX_TRAIL = 400;
const MAX_POIS = 120;

// Narration should lead the landmark, not trail it. The lead is roughly the
// length of the spoken story (~18 s), so the facts finish just as the driver
// reaches the place, and it grows with speed so this holds on a motorway too.
const CUE_BASE_METERS = 300;
const CUE_SECONDS = 18;
const MAX_CUE_METERS = 1600;

// A landmark this far off the line of travel is on another street, or in a town
// the motorway merely passes, so it is not something to narrate.
const LATERAL_BASE_METERS = 180;
const LATERAL_MAX_METERS = 600;
// Already-passed places are dropped, with a small grace for GPS lag.
const BEHIND_TOLERANCE_METERS = 40;

// Fixes worse than this say too little about which side of the road you are on
// to time a story; ones worse still are not worth drawing either.
const NARRATION_MAX_ACCURACY = 300;
const DROP_ACCURACY = 500;
// A fix implying faster than this is a GPS spike, not a drive.
const MAX_JUMP_SPEED = 75;
// Heading is only trustworthy once actually rolling.
const MOVING_FOR_HEADING = 3;

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
      // Pick the clearest installed English voice before the first story.
      void prepareVoice();
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
// Stories no longer collide: a new one only starts once the previous has
// finished speaking. This short gap is just a backstop after a manual stop.
const NARRATE_MIN_GAP_MS = 2500;
let lastNarrateAt = 0;

/**
 * Narrate a place. `lead` is how many metres ahead it is when the engine chose
 * it automatically, which lets the script say "700 metres ahead"; manual taps
 * pass nothing.
 */
export async function narratePoi(poi: Poi, lead?: number | null): Promise<void> {
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

    const text = buildScript(title, poi.kind, extract, lead ?? null);
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

/** How far either side of the road a place may sit and still be on the route. */
function lateralLimit(cue: number): number {
  return Math.min(LATERAL_MAX_METERS, Math.max(LATERAL_BASE_METERS, cue * 0.3));
}

/** Keep places far enough ahead in the list when the cue window is wide. */
function fetchRadius(speed: number | null): number {
  return Math.min(
    MAX_FETCH_RADIUS,
    Math.max(FETCH_RADIUS, Math.round(cueDistance(speed) * 1.2)),
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
  // Never talk over the story already playing, and give the speaker a beat
  // after it ends instead of chasing every fix.
  if (isSpeaking() || Date.now() - lastNarrateAt < NARRATE_MIN_GAP_MS) return;
  // A coarse fix cannot tell which side of the road a place is on.
  if (position.accuracy !== null && position.accuracy > NARRATION_MAX_ACCURACY) return;
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
  const slack = Math.min(position.accuracy ?? 0, 100);
  const cue = cueDistance(position.speed) + slack;
  const lateral = lateralLimit(cue) + slack;
  // Heading is only trustworthy while actually rolling; at a red light it can
  // be stale, so the directional test only applies on the move.
  const moving = (position.speed ?? 0) > MOVING_FOR_HEADING;
  const nose = position.heading;

  const candidates = list
    .map((poi) => {
      const distance = haversine(lat, lng, poi.lat, poi.lng);
      let along = distance;
      let off = 0;
      if (moving && nose !== null) {
        // Split the distance into how far ahead along the line of travel the
        // place is, and how far off that line it sits. This ignores a place on
        // a parallel street and rejects one already behind the car, whatever
        // the compass says.
        const gap = (angleGap(
          bearing(lat, lng, poi.lat, poi.lng),
          nose,
        ) *
          Math.PI) /
          180;
        along = distance * Math.cos(gap);
        off = Math.abs(distance * Math.sin(gap));
      }
      return { poi, distance, along, off };
    })
    .filter((item) => item.distance <= cue)
    .filter((item) => item.poi.interest >= settings.minInterest)
    .filter((item) => item.along >= -BEHIND_TOLERANCE_METERS)
    .filter((item) => item.off <= lateral)
    // Soonest reached first: the cue window is wide at speed, so announce the
    // place the car gets to next rather than the best one further up the road.
    .sort((a, b) => a.along - b.along || b.poi.interest - a.poi.interest);

  for (const candidate of candidates) {
    const skip = await wasNarratedRecently(candidate.poi.id, lat, lng).catch(
      () => false,
    );
    if (skip) continue;
    void narratePoi(candidate.poi, Math.max(0, candidate.along));
    break;
  }
}

let lastFetch: { lat: number; lng: number; at: number } | null = null;
let lastFix: { lat: number; lng: number; at: number } | null = null;

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

  const keepRadius = fetchRadius(state.position?.speed ?? null) * 1.5;
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

    // A fix this coarse is a cell-tower estimate, not a road position.
    if (accuracy !== null && accuracy > DROP_ACCURACY) return;

    const now = Date.now();
    // Reject impossible jumps, which GPS hands out when it re-acquires in a
    // tunnel or between tall buildings; one spike would skip a whole story.
    if (lastFix) {
      const seconds = Math.max(1, (now - lastFix.at) / 1000);
      const jump = haversine(lastFix.lat, lastFix.lng, coords.latitude, coords.longitude);
      if (jump > MAX_JUMP_SPEED * seconds) return;
    }
    lastFix = { lat: coords.latitude, lng: coords.longitude, at: now };

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
