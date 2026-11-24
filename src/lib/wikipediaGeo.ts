import { Poi } from '../types';
import { haversine } from './geo';
import { USER_AGENT } from './userAgent';

const LANG = 'en';
const API = `https://${LANG}.wikipedia.org/w/api.php`;

interface GeoHit {
  pageid: number;
  title: string;
  lat: number;
  lon: number;
}

interface GeoResponse {
  query?: { geosearch?: GeoHit[] };
}

interface DescriptionResponse {
  query?: {
    pages?: Record<
      string,
      { title?: string; description?: string; thumbnail?: { source?: string } }
    >;
  };
}

type Rule = { test: RegExp; kind: string; category: string; score: number };

// Checked in order, so "Dam Square" is a square rather than a dam.
const RULES: Rule[] = [
  { test: /\b(square|plein|platz)\b/i, kind: 'square', category: 'tourism', score: 74 },
  { test: /\b(canal|gracht)\b/i, kind: 'canal', category: 'waterway', score: 66 },
  { test: /\bpalace\b/i, kind: 'palace', category: 'historic', score: 90 },
  { test: /\b(castle|fortress|citadel)\b/i, kind: 'castle', category: 'historic', score: 92 },
  { test: /\b(cathedral|basilica)\b/i, kind: 'cathedral', category: 'amenity', score: 82 },
  {
    test: /\b(church|chapel|synagogue|mosque|temple|minster)\b/i,
    kind: 'place of worship',
    category: 'amenity',
    score: 70,
  },
  { test: /\bmuseum\b/i, kind: 'museum', category: 'tourism', score: 84 },
  { test: /\bgallery\b/i, kind: 'gallery', category: 'tourism', score: 70 },
  { test: /\blighthouse\b/i, kind: 'lighthouse', category: 'man_made', score: 91 },
  { test: /\b(windmill|watermill)\b/i, kind: 'windmill', category: 'man_made', score: 77 },
  {
    test: /\b(monument|memorial|statue|obelisk)\b/i,
    kind: 'monument',
    category: 'historic',
    score: 88,
  },
  { test: /\bbridge\b/i, kind: 'bridge', category: 'man_made', score: 84 },
  { test: /\btower\b/i, kind: 'tower', category: 'man_made', score: 76 },
  { test: /\bdams?\b/i, kind: 'dam', category: 'waterway', score: 94 },
  { test: /\b(park|garden|botanical)\b/i, kind: 'park', category: 'leisure', score: 62 },
  {
    test: /\b(theatre|theater|opera|concert hall|concertgebouw)\b/i,
    kind: 'theatre',
    category: 'amenity',
    score: 74,
  },
  { test: /\blibrary\b/i, kind: 'library', category: 'amenity', score: 58 },
  { test: /\b(market|marketplace)\b/i, kind: 'marketplace', category: 'amenity', score: 58 },
  { test: /\b(station|terminal)\b/i, kind: 'station', category: 'transport', score: 60 },
  { test: /\b(university|academy|college)\b/i, kind: 'university', category: 'education', score: 58 },
  { test: /\b(stadium|arena)\b/i, kind: 'stadium', category: 'leisure', score: 62 },
  { test: /\b(zoo|aquarium)\b/i, kind: 'zoo', category: 'tourism', score: 80 },
  { test: /\b(exchange|beurs)\b/i, kind: 'historic building', category: 'historic', score: 76 },
  { test: /\b(house|huis)\b/i, kind: 'historic house', category: 'historic', score: 64 },
  { test: /\b(hotel)\b/i, kind: 'hotel', category: 'tourism', score: 50 },
  { test: /\b(building|gebouw|hall|halle)\b/i, kind: 'building', category: 'historic', score: 56 },
];

// Articles about events and people sit on the map but are not places to tour.
const NOT_A_PLACE =
  /^(\d{4}\b)|\b(timeline of|list of|inauguration of|shooting|assassination|murder|battle of|election|referendum|riot|demonstration|protest|crash|derailment|fire|epidemic|pandemic)\b/i;

function classifyText(text: string): { kind: string; category: string; score: number } | null {
  if (NOT_A_PLACE.test(text)) return null;
  for (const rule of RULES) {
    if (rule.test.test(text)) {
      return { kind: rule.kind, category: rule.category, score: rule.score };
    }
  }
  return null;
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
}

async function getJson<T>(url: string, timeoutMs = 9000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Wikipedia responded ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Free, keyless POI source built on Wikipedia's geosearch. Used alongside
 * OpenStreetMap so the tour still finds landmarks when Overpass is blocked,
 * slow or rate limited. One batched request adds short descriptions, which
 * give us a reliable place type (church, palace, museum…).
 */
export async function fetchWikipediaPois(
  lat: number,
  lng: number,
  radius: number,
): Promise<Poi[]> {
  const geoParams = new URLSearchParams({
    action: 'query',
    format: 'json',
    list: 'geosearch',
    gscoord: `${lat}|${lng}`,
    gsradius: String(Math.round(Math.min(radius * 1.6, 10000))),
    gslimit: '50',
  });

  const geo = await getJson<GeoResponse>(`${API}?${geoParams.toString()}`);
  const hits = (geo.query?.geosearch ?? []).filter(
    (hit) => typeof hit.lat === 'number' && typeof hit.lon === 'number',
  );
  if (hits.length === 0) return [];

  const titles = hits.map((hit) => hit.title).join('|');
  const descriptions = await getJson<DescriptionResponse>(
    `${API}?${new URLSearchParams({
      action: 'query',
      format: 'json',
      // One batched call supplies both the place type and a thumbnail, which
      // the map draws as the pin's picture.
      prop: 'description|pageimages',
      piprop: 'thumbnail',
      pithumbsize: '320',
      titles,
      redirects: '1',
    }).toString()}`,
  ).catch(() => ({}) as DescriptionResponse);

  const byTitle = new Map<string, string>();
  const imageByTitle = new Map<string, string>();
  for (const page of Object.values(descriptions.query?.pages ?? {})) {
    if (!page.title) continue;
    byTitle.set(page.title, page.description ?? '');
    const source = page.thumbnail?.source;
    if (source) imageByTitle.set(page.title, source);
  }

  const seen = new Map<string, Poi>();
  for (const hit of hits) {
    const description = byTitle.get(hit.title) ?? '';
    const classified = classifyText(`${hit.title} ${description}`);
    if (!classified) continue;

    const key = normalize(hit.title);
    if (seen.has(key)) continue;

    seen.set(key, {
      id: `wiki/${hit.pageid}`,
      name: hit.title.replace(/\s*\([^)]*\)\s*$/, ''),
      kind: classified.kind,
      category: classified.category,
      lat: hit.lat,
      lng: hit.lon,
      // Every result is a Wikipedia article, so nudge it above raw OSM tags.
      interest: Math.min(100, classified.score + 6),
      wikipedia: `${LANG}:${hit.title}`,
      image: imageByTitle.get(hit.title) ?? null,
    });
  }

  return Array.from(seen.values()).sort(
    (a, b) =>
      b.interest - a.interest ||
      haversine(lat, lng, a.lat, a.lng) - haversine(lat, lng, b.lat, b.lng),
  );
}
