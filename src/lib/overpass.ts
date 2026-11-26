import { Poi } from '../types';
import { classify } from './interests';
import { haversine } from './geo';
import { USER_AGENT } from './userAgent';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

function buildQuery(lat: number, lng: number, radius: number): string {
  const around = `(around:${Math.round(radius)},${lat},${lng})`;
  return `[out:json][timeout:25];
(
  nwr["historic"]${around};
  nwr["man_made"~"^(dam|bridge|water_tower|lighthouse|tower|pier|windmill|watermill|obelisk|monument|mineshaft)$"]${around};
  nwr["waterway"~"^(dam|weir)$"]${around};
  nwr["tourism"~"^(attraction|museum|viewpoint|artwork|zoo|theme_park|aquarium|gallery|camp_site|caravan_site)$"]${around};
  nwr["natural"~"^(peak|hill|ridge|spring|cave_entrance|beach|bay|cape|island|peninsula|valley|gorge|cliff|wetland|wood|waterfall|dune)$"]${around};
  nwr["leisure"~"^(park|nature_reserve|garden|stadium|golf_course|marina)$"]${around};
  nwr["amenity"~"^(place_of_worship|theatre|library|townhall|marketplace|university|college|ferry_terminal)$"]${around};
  nwr["place"~"^(city|town|township|village|hamlet|suburb|neighbourhood|quarter|locality|farm)$"]${around};
  nwr["landuse"~"^(quarry|vineyard|orchard|cemetery)$"]${around};
  nwr["aeroway"="aerodrome"]${around};
  nwr["railway"~"^(station|halt)$"]${around};
);
out center tags 500;`;
}

function elementToPoi(el: OverpassElement, originLat: number, originLng: number): Poi | null {
  const tags = el.tags ?? {};
  const name = tags.name || tags['name:en'];
  if (!name) return null;

  const classified = classify(tags);
  if (!classified) return null;

  const lat = typeof el.lat === 'number' ? el.lat : el.center?.lat;
  const lng = typeof el.lon === 'number' ? el.lon : el.center?.lon;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  return {
    id: `${el.type}/${el.id}`,
    name,
    kind: classified.kind,
    category: classified.category,
    lat,
    lng,
    interest: classified.score,
    wikipedia: tags.wikipedia,
    source: 'osm',
  };
}

async function request(endpoint: string, query: string): Promise<OverpassResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 22000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Overpass responded ${response.status}`);
    return (await response.json()) as OverpassResponse;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Look up interesting places around a coordinate. Tries a couple of free
 * Overpass mirrors before giving up, so a single mirror outage is not fatal.
 */
export async function fetchNearbyPois(
  lat: number,
  lng: number,
  radius: number,
): Promise<Poi[]> {
  // A wider circle than the narration window keeps the map populated between
  // towns, where the next named place can be several kilometres away.
  const reach = Math.min(8000, Math.max(radius, 3000));
  const query = buildQuery(lat, lng, reach);
  let data: OverpassResponse | null = null;
  let lastError: unknown = null;

  for (const endpoint of ENDPOINTS) {
    try {
      data = await request(endpoint, query);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!data) throw lastError ?? new Error('Overpass unavailable');

  const seen = new Map<string, Poi>();
  for (const el of data.elements ?? []) {
    const poi = elementToPoi(el, lat, lng);
    if (poi) seen.set(poi.id, poi);
  }

  return Array.from(seen.values()).sort(
    (a, b) =>
      b.interest - a.interest ||
      haversine(lat, lng, a.lat, a.lng) - haversine(lat, lng, b.lat, b.lng),
  );
}
