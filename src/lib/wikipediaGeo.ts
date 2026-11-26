import { Poi } from '../types';
import { haversine } from './geo';
import { classifyPlace } from './placeText';
import { USER_AGENT } from './userAgent';

interface Source {
  host: string;
  lang: string;
  source: 'wikipedia' | 'wikivoyage';
  bonus: number;
}

// Wikivoyage articles are written for travellers, so their intro is a better
// story than a bare encyclopaedia line, but there are far fewer of them.
const SOURCES: Source[] = [
  { host: 'en.wikipedia.org', lang: 'en', source: 'wikipedia', bonus: 4 },
  { host: 'en.wikivoyage.org', lang: 'en', source: 'wikivoyage', bonus: 6 },
];

interface GeoHit {
  pageid: number;
  title: string;
  lat: number;
  lon: number;
}

interface GeoResponse {
  query?: { geosearch?: GeoHit[] };
}

interface DetailPage {
  title?: string;
  description?: string;
  thumbnail?: { source?: string };
}

interface DetailResponse {
  query?: { pages?: Record<string, DetailPage> };
}

// The geosearch API caps a circle at 10 km, so the reach is widened to that in
// the countryside and kept modest in a dense city.
const MAX_REACH = 10000;
const MIN_REACH = 6000;
const MAX_HITS = 90;
const DETAIL_BATCH = 20;

function reachFor(radius: number): number {
  return Math.min(MAX_REACH, Math.max(MIN_REACH, Math.round(radius * 2)));
}

async function getJson<T>(url: string, timeoutMs = 9000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`MediaWiki responded ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function geosearch(
  source: Source,
  lat: number,
  lng: number,
  reach: number,
): Promise<GeoHit[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    list: 'geosearch',
    gscoord: `${lat}|${lng}`,
    gsradius: String(reach),
    gslimit: '200',
    gsnamespace: '0',
  });
  const data = await getJson<GeoResponse>(`https://${source.host}/w/api.php?${params.toString()}`);
  return (data.query?.geosearch ?? []).filter(
    (hit) => typeof hit.lat === 'number' && typeof hit.lon === 'number',
  );
}

/** One batched call adds the short description that tells us what kind of place it is. */
async function details(source: Source, titles: string[]): Promise<Map<string, DetailPage>> {
  const out = new Map<string, DetailPage>();
  const batches: string[][] = [];
  for (let i = 0; i < titles.length; i += DETAIL_BATCH) {
    batches.push(titles.slice(i, i + DETAIL_BATCH));
  }

  await Promise.all(
    batches.map(async (batch) => {
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        prop: 'description|pageimages',
        piprop: 'thumbnail',
        pithumbsize: '320',
        titles: batch.join('|'),
        redirects: '1',
      });
      try {
        const data = await getJson<DetailResponse>(
          `https://${source.host}/w/api.php?${params.toString()}`,
          8000,
        );
        for (const page of Object.values(data.query?.pages ?? {})) {
          if (page.title) out.set(page.title, page);
        }
      } catch {
        // descriptions are optional; titles alone still give pins
      }
    }),
  );

  return out;
}

async function fromSource(
  source: Source,
  lat: number,
  lng: number,
  reach: number,
): Promise<Poi[]> {
  const hits = await geosearch(source, lat, lng, reach);
  if (hits.length === 0) return [];

  // Dense cities return hundreds of hits; the nearest are the ones that matter.
  const nearest = [...hits]
    .sort((a, b) => haversine(lat, lng, a.lat, a.lon) - haversine(lat, lng, b.lat, b.lon))
    .slice(0, MAX_HITS);

  const detail = await details(
    source,
    nearest.map((hit) => hit.title),
  );

  const seen = new Map<string, Poi>();
  for (const hit of nearest) {
    const page = detail.get(hit.title);
    const description = page?.description ?? '';
    const name = hit.title.replace(/\s*\([^)]*\)\s*$/, '');
    const classified = classifyPlace(description, name);
    if (!classified) continue;

    const key = name.toLowerCase().trim();
    if (seen.has(key)) continue;

    seen.set(key, {
      id: `${source.source}/${hit.pageid}`,
      name,
      kind: classified.kind,
      category: classified.category,
      lat: hit.lat,
      lng: hit.lon,
      interest: Math.min(100, classified.score + source.bonus),
      wikipedia: `${source.lang}:${hit.title}`,
      image: page?.thumbnail?.source ?? null,
      source: source.source,
      note: description || null,
    });
  }

  return Array.from(seen.values());
}

/**
 * Free, keyless POI source built on Wikipedia and Wikivoyage geosearch. Used
 * alongside OpenStreetMap and Wikidata so the tour still finds places when
 * Overpass is blocked, slow or rate limited.
 */
export async function fetchWikipediaPois(
  lat: number,
  lng: number,
  radius: number,
): Promise<Poi[]> {
  const reach = reachFor(radius);
  const results = await Promise.allSettled(
    SOURCES.map((source) => fromSource(source, lat, lng, reach)),
  );

  const merged = new Map<string, Poi>();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const poi of result.value) {
      const key = poi.name.toLowerCase().trim();
      const existing = merged.get(key);
      if (!existing || poi.interest > existing.interest) merged.set(key, poi);
    }
  }

  return Array.from(merged.values()).sort(
    (a, b) =>
      b.interest - a.interest ||
      haversine(lat, lng, a.lat, a.lng) - haversine(lat, lng, b.lat, b.lng),
  );
}
