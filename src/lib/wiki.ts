import { Poi } from '../types';
import { USER_AGENT } from './userAgent';

export interface WikiSummary {
  title: string;
  extract: string;
  image: string | null;
}

const STOP_WORDS = new Set(['the', 'and', 'of', 'a', 'an', 'de', 'la', 'el', 'old', 'new']);

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

interface SummaryPage {
  title?: string;
  extract?: string;
  thumbnail?: { source?: string };
}

async function fromTag(poi: Poi): Promise<WikiSummary | null> {
  if (!poi.wikipedia) return null;
  const parts = poi.wikipedia.split(':');
  const language = parts.length > 1 ? parts[0] : 'en';
  const title = parts.length > 1 ? parts.slice(1).join(':') : parts[0];
  if (!title) return null;

  try {
    const response = await fetch(
      `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
        title,
      )}?redirect=true`,
      { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as SummaryPage;
    if (!data.extract) return null;
    return {
      title: data.title || title,
      extract: data.extract,
      image: data.thumbnail?.source ?? null,
    };
  } catch {
    return null;
  }
}

async function fromSearch(poi: Poi): Promise<WikiSummary | null> {
  // Ask Wikipedia for the best matching article about this place, with a
  // short intro extract and a thumbnail in one request.
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: poi.name,
    gsrlimit: '1',
    prop: 'extracts|pageimages',
    exintro: '1',
    explaintext: '1',
    piprop: 'thumbnail',
    pithumbsize: '480',
    format: 'json',
    origin: '*',
  });

  try {
    const response = await fetch(`https://en.wikipedia.org/w/api.php?${params.toString()}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      query?: { pages?: Record<string, SummaryPage> };
    };
    const pages = data.query?.pages;
    if (!pages) return null;
    const page = Object.values(pages)[0];
    if (!page?.extract) return null;

    // Guard against unrelated articles that merely share a word.
    const title: string = page.title || poi.name;
    const placeTokens = new Set(tokens(poi.name));
    const titleTokens = new Set(tokens(title));
    let overlap = 0;
    for (const token of placeTokens) if (titleTokens.has(token)) overlap += 1;
    if (overlap === 0) return null;

    return {
      title,
      extract: page.extract,
      image: page.thumbnail?.source ?? null,
    };
  } catch {
    return null;
  }
}

/** Look up a short summary for a place, using its OSM tag first, then search. */
export async function fetchSummary(poi: Poi): Promise<WikiSummary | null> {
  return (await fromTag(poi)) ?? (await fromSearch(poi));
}
