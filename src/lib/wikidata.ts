import { Poi } from '../types';
import { haversine } from './geo';
import { classifyPlace, isPlaceholderName } from './placeText';
import { USER_AGENT } from './userAgent';

/**
 * Wikidata is the broadest free, keyless map of the world: every town, suburb,
 * farm, mountain, pass, dam, school and reserve with a coordinate lives here,
 * along with a one-line English description and a link to its article. That is
 * what keeps the tour talking on an empty Karoo road, where OpenStreetMap
 * mirrors are slow and Wikipedia's 10 km geosearch has nothing to return.
 */

const ENDPOINT = 'https://query.wikidata.org/sparql';
const MAX_ITEMS = 300;
const PAGEIMAGE_BATCH = 20;
// An empty circle means empty narration, so the radius is widened once.
const SPARSE_THRESHOLD = 15;
const WIDE_RADIUS_KM = 30;

interface Binding {
  item?: { value: string };
  itemLabel?: { value: string };
  itemDescription?: { value: string };
  coord?: { value: string };
  article?: { value: string };
}

interface SparqlResponse {
  results?: { bindings?: Binding[] };
}

function query(lat: number, lng: number, radiusKm: number): string {
  return `SELECT ?item ?itemLabel ?itemDescription ?coord ?article WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point(${lng} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${radiusKm}" .
  }
  OPTIONAL {
    ?article schema:about ?item ;
             schema:isPartOf <https://en.wikipedia.org/> .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,af". }
}
LIMIT ${MAX_ITEMS}`;
}

async function sparql(lat: number, lng: number, radiusKm: number): Promise<Binding[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14000);
  try {
    const response = await fetch(
      `${ENDPOINT}?format=json&query=${encodeURIComponent(query(lat, lng, radiusKm))}`,
      {
        headers: {
          Accept: 'application/sparql-results+json',
          'User-Agent': USER_AGENT,
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new Error(`Wikidata responded ${response.status}`);
    const data = (await response.json()) as SparqlResponse;
    return data.results?.bindings ?? [];
  } finally {
    clearTimeout(timer);
  }
}

function parsePoint(wkt: string | undefined): { lat: number; lng: number } | null {
  const match = /Point\(([-\d.]+)\s+([-\d.]+)\)/.exec(wkt ?? '');
  if (!match) return null;
  const lng = Number(match[1]);
  const lat = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function articleTitle(url: string | undefined): string | null {
  if (!url) return null;
  const tail = url.split('/wiki/')[1];
  if (!tail) return null;
  try {
    return decodeURIComponent(tail).replace(/_/g, ' ');
  } catch {
    return tail.replace(/_/g, ' ');
  }
}

/** One batched request adds photos for the nearest places that have articles. */
async function fetchThumbnails(titles: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (titles.length === 0) return out;

  const batches: string[][] = [];
  for (let i = 0; i < titles.length; i += PAGEIMAGE_BATCH) {
    batches.push(titles.slice(i, i + PAGEIMAGE_BATCH));
  }

  await Promise.all(
    batches.map(async (batch) => {
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        prop: 'pageimages',
        piprop: 'thumbnail',
        pithumbsize: '320',
        titles: batch.join('|'),
        redirects: '1',
      });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      try {
        const response = await fetch(`https://en.wikipedia.org/w/api.php?${params.toString()}`, {
          headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = (await response.json()) as {
          query?: { pages?: Record<string, { title?: string; thumbnail?: { source?: string } }> };
        };
        for (const page of Object.values(data.query?.pages ?? {})) {
          if (page.title && page.thumbnail?.source) out.set(page.title, page.thumbnail.source);
        }
      } catch {
        // photos are a bonus, never a reason to lose the place
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  return out;
}

function toPois(rows: Binding[], lat: number, lng: number): Poi[] {
  const byItem = new Map<string, Poi>();
  for (const row of rows) {
    const qid = row.item?.value.split('/').pop();
    if (!qid || byItem.has(qid)) continue;

    const point = parsePoint(row.coord?.value);
    if (!point) continue;

    const article = articleTitle(row.article?.value);
    const label = row.itemLabel?.value ?? '';
    const name = !label || isPlaceholderName(label) ? article : label;
    if (!name) continue;

    const description = row.itemDescription?.value ?? '';
    const classified = classifyPlace(description, name);
    if (!classified) continue;

    // A place with an article can be read out in full, so it is worth more.
    const interest = Math.min(100, classified.score + (article ? 4 : 0));

    byItem.set(qid, {
      id: `wd/${qid}`,
      name,
      kind: classified.kind,
      category: classified.category,
      lat: point.lat,
      lng: point.lng,
      interest,
      wikipedia: article ? `en:${article}` : undefined,
      image: null,
      source: 'wikidata',
      note: description || null,
    });
  }

  return Array.from(byItem.values()).sort(
    (a, b) =>
      b.interest - a.interest ||
      haversine(lat, lng, a.lat, a.lng) - haversine(lat, lng, b.lat, b.lng),
  );
}

/**
 * Look up every mapped place around a coordinate. Sparse countryside (a Karoo
 * road, a Limpopo farm road) can have nothing within the normal circle, so the
 * query is widened once before the tour is left with silence.
 */
export async function fetchWikidataPois(
  lat: number,
  lng: number,
  radiusKm: number,
): Promise<Poi[]> {
  let pois = toPois(await sparql(lat, lng, radiusKm), lat, lng);

  if (pois.length < SPARSE_THRESHOLD && radiusKm < WIDE_RADIUS_KM) {
    try {
      const wider = toPois(await sparql(lat, lng, WIDE_RADIUS_KM), lat, lng);
      const seen = new Map(pois.map((poi) => [poi.id, poi]));
      for (const poi of wider) seen.set(poi.id, poi);
      pois = Array.from(seen.values()).sort(
        (a, b) =>
          haversine(lat, lng, a.lat, a.lng) - haversine(lat, lng, b.lat, b.lng) ||
          b.interest - a.interest,
      );
    } catch {
      // the narrow result is still usable
    }
  }

  // Only the closest handful can actually be reached while driving, so only
  // they need the extra request that gives their pins a photo.
  const nearest = [...pois]
    .sort((a, b) => haversine(lat, lng, a.lat, a.lng) - haversine(lat, lng, b.lat, b.lng))
    .slice(0, PAGEIMAGE_BATCH * 2);
  const titled = nearest
    .map((poi) => (poi.wikipedia ? poi.wikipedia.replace(/^en:/, '') : null))
    .filter((title): title is string => !!title);

  if (titled.length > 0) {
    const images = await fetchThumbnails(titled).catch(() => new Map<string, string>());
    for (const poi of nearest) {
      const title = poi.wikipedia?.replace(/^en:/, '');
      if (title && images.has(title)) poi.image = images.get(title) ?? null;
    }
  }

  return pois;
}
