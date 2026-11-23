export interface Classified {
  kind: string;
  category: string;
  score: number;
}

interface KindScore {
  kind: string;
  score: number;
}

const HISTORIC: Record<string, KindScore> = {
  castle: { kind: 'castle', score: 92 },
  monument: { kind: 'monument', score: 90 },
  memorial: { kind: 'memorial', score: 80 },
  ruins: { kind: 'ruins', score: 86 },
  archaeological_site: { kind: 'archaeological site', score: 88 },
  battlefield: { kind: 'battlefield', score: 85 },
  city_gate: { kind: 'city gate', score: 76 },
  fort: { kind: 'fort', score: 83 },
  manor: { kind: 'manor house', score: 76 },
  tower: { kind: 'historic tower', score: 79 },
  bridge: { kind: 'historic bridge', score: 80 },
  church: { kind: 'historic church', score: 70 },
  well: { kind: 'historic well', score: 60 },
  wayside_cross: { kind: 'wayside cross', score: 55 },
  yes: { kind: 'historic site', score: 74 },
};

const MAN_MADE: Record<string, KindScore> = {
  dam: { kind: 'dam', score: 94 },
  bridge: { kind: 'bridge', score: 84 },
  water_tower: { kind: 'water tower', score: 68 },
  lighthouse: { kind: 'lighthouse', score: 91 },
  tower: { kind: 'tower', score: 73 },
  pier: { kind: 'pier', score: 58 },
  windmill: { kind: 'windmill', score: 77 },
  obelisk: { kind: 'obelisk', score: 75 },
  watermill: { kind: 'watermill', score: 72 },
  monument: { kind: 'monument', score: 90 },
  mast: { kind: 'mast', score: 45 },
  chimney: { kind: 'chimney', score: 50 },
};

const TOURISM: Record<string, KindScore> = {
  attraction: { kind: 'attraction', score: 82 },
  museum: { kind: 'museum', score: 84 },
  viewpoint: { kind: 'viewpoint', score: 76 },
  artwork: { kind: 'artwork', score: 62 },
  zoo: { kind: 'zoo', score: 80 },
  theme_park: { kind: 'theme park', score: 78 },
  aquarium: { kind: 'aquarium', score: 80 },
  gallery: { kind: 'gallery', score: 74 },
};

const NATURAL: Record<string, KindScore> = {
  peak: { kind: 'peak', score: 78 },
  spring: { kind: 'spring', score: 52 },
  cave_entrance: { kind: 'cave', score: 72 },
  beach: { kind: 'beach', score: 60 },
};

const LEISURE: Record<string, KindScore> = {
  park: { kind: 'park', score: 58 },
  nature_reserve: { kind: 'nature reserve', score: 68 },
  garden: { kind: 'garden', score: 60 },
};

const AMENITY: Record<string, KindScore> = {
  place_of_worship: { kind: 'place of worship', score: 64 },
  theatre: { kind: 'theatre', score: 72 },
  library: { kind: 'library', score: 56 },
  townhall: { kind: 'town hall', score: 58 },
  marketplace: { kind: 'marketplace', score: 52 },
};

/**
 * Classify a set of OSM tags. Returns null for features we do not want to
 * narrate. Higher scores are more interesting to a passing driver.
 */
export function classify(tags: Record<string, string>): Classified | null {
  const bump = tags.wikipedia || tags.wikidata ? 10 : 0;
  const out = (kind: string, category: string, score: number): Classified => ({
    kind,
    category,
    score: Math.min(100, score + bump),
  });

  if (tags.waterway === 'dam') return out('dam', 'waterway', 94);
  if (tags.waterway === 'weir') return out('weir', 'waterway', 70);

  if (tags.man_made && MAN_MADE[tags.man_made]) {
    const m = MAN_MADE[tags.man_made];
    return out(m.kind, 'man_made', m.score);
  }
  if (tags.historic && HISTORIC[tags.historic]) {
    const h = HISTORIC[tags.historic];
    return out(h.kind, 'historic', h.score);
  }
  if (tags.tourism && TOURISM[tags.tourism]) {
    const t = TOURISM[tags.tourism];
    return out(t.kind, 'tourism', t.score);
  }
  if (tags.natural && NATURAL[tags.natural]) {
    const n = NATURAL[tags.natural];
    return out(n.kind, 'natural', n.score);
  }
  if (tags.leisure && LEISURE[tags.leisure]) {
    const l = LEISURE[tags.leisure];
    return out(l.kind, 'leisure', l.score);
  }
  if (tags.amenity && AMENITY[tags.amenity]) {
    const a = AMENITY[tags.amenity];
    return out(a.kind, 'amenity', a.score);
  }
  return null;
}
