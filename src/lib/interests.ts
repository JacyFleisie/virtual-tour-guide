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
  mine: { kind: 'historic mine', score: 74 },
  farm: { kind: 'historic farm', score: 68 },
  yes: { kind: 'historic site', score: 74 },
};

const MAN_MADE: Record<string, KindScore> = {
  dam: { kind: 'dam', score: 94 },
  bridge: { kind: 'bridge', score: 84 },
  water_tower: { kind: 'water tower', score: 68 },
  lighthouse: { kind: 'lighthouse', score: 91 },
  tower: { kind: 'tower', score: 73 },
  pier: { kind: 'harbour', score: 66 },
  windmill: { kind: 'windmill', score: 77 },
  obelisk: { kind: 'obelisk', score: 75 },
  watermill: { kind: 'watermill', score: 72 },
  monument: { kind: 'monument', score: 90 },
  mast: { kind: 'mast', score: 45 },
  chimney: { kind: 'chimney', score: 50 },
  mineshaft: { kind: 'mine', score: 74 },
  adit: { kind: 'mine', score: 72 },
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
  hotel: { kind: 'hotel', score: 54 },
  guest_house: { kind: 'hotel', score: 48 },
  information: { kind: 'visitor centre', score: 52 },
  camp_site: { kind: 'campsite', score: 56 },
  caravan_site: { kind: 'campsite', score: 52 },
  picnic_site: { kind: 'picnic site', score: 50 },
};

const NATURAL: Record<string, KindScore> = {
  peak: { kind: 'mountain', score: 80 },
  hill: { kind: 'hill', score: 66 },
  ridge: { kind: 'hill', score: 70 },
  spring: { kind: 'spring', score: 58 },
  cave_entrance: { kind: 'cave', score: 74 },
  beach: { kind: 'beach', score: 68 },
  bay: { kind: 'bay', score: 78 },
  cape: { kind: 'peninsula', score: 74 },
  island: { kind: 'island', score: 80 },
  islet: { kind: 'island', score: 72 },
  peninsula: { kind: 'peninsula', score: 74 },
  valley: { kind: 'pass', score: 72 },
  gorge: { kind: 'pass', score: 74 },
  cliff: { kind: 'hill', score: 68 },
  water: { kind: 'water', score: 62 },
  wetland: { kind: 'wetland', score: 66 },
  wood: { kind: 'forest', score: 60 },
  waterfall: { kind: 'waterfall', score: 74 },
  dune: { kind: 'beach', score: 58 },
};

const LEISURE: Record<string, KindScore> = {
  park: { kind: 'park', score: 58 },
  nature_reserve: { kind: 'nature reserve', score: 80 },
  garden: { kind: 'garden', score: 60 },
  stadium: { kind: 'stadium', score: 66 },
  sports_centre: { kind: 'sports centre', score: 50 },
  golf_course: { kind: 'golf course', score: 60 },
  marina: { kind: 'harbour', score: 72 },
  playground: { kind: 'playground', score: 40 },
};

const AMENITY: Record<string, KindScore> = {
  place_of_worship: { kind: 'place of worship', score: 64 },
  theatre: { kind: 'theatre', score: 72 },
  library: { kind: 'library', score: 56 },
  townhall: { kind: 'town hall', score: 58 },
  marketplace: { kind: 'marketplace', score: 54 },
  university: { kind: 'university', score: 78 },
  college: { kind: 'college', score: 72 },
  school: { kind: 'school', score: 52 },
  hospital: { kind: 'hospital', score: 52 },
  prison: { kind: 'prison', score: 52 },
  ferry_terminal: { kind: 'ferry terminal', score: 64 },
  bus_station: { kind: 'station', score: 54 },
  arts_centre: { kind: 'theatre', score: 62 },
  community_centre: { kind: 'community centre', score: 48 },
};

const PLACE: Record<string, KindScore> = {
  city: { kind: 'city', score: 88 },
  town: { kind: 'town', score: 84 },
  township: { kind: 'township', score: 82 },
  village: { kind: 'village', score: 80 },
  hamlet: { kind: 'hamlet', score: 76 },
  suburb: { kind: 'suburb', score: 66 },
  neighbourhood: { kind: 'suburb', score: 64 },
  quarter: { kind: 'suburb', score: 62 },
  locality: { kind: 'place', score: 62 },
  isolated_dwelling: { kind: 'place', score: 56 },
  farm: { kind: 'farm', score: 68 },
};

const LANDUSE: Record<string, KindScore> = {
  quarry: { kind: 'quarry', score: 68 },
  vineyard: { kind: 'wine estate', score: 76 },
  orchard: { kind: 'orchard', score: 60 },
  cemetery: { kind: 'cemetery', score: 60 },
  industrial: { kind: 'industrial site', score: 46 },
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

  if (tags.aeroway === 'aerodrome') return out('airport', 'transport', 78);
  if (tags.railway && (tags.railway === 'station' || tags.railway === 'halt')) {
    return out('station', 'transport', tags.railway === 'station' ? 62 : 54);
  }

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
  if (tags.place && PLACE[tags.place]) {
    const p = PLACE[tags.place];
    return out(p.kind, 'place', p.score);
  }
  if (tags.landuse && LANDUSE[tags.landuse]) {
    const l = LANDUSE[tags.landuse];
    return out(l.kind, 'landuse', l.score);
  }
  return null;
}
