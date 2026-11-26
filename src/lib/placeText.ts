/**
 * One place classifier shared by every data source. Wikipedia, Wikivoyage and
 * Wikidata all describe a place with a short phrase ("town in the Western
 * Cape", "palaeontological site in South Africa", "mountain range in Limpopo"),
 * so the same rules can turn any of them into a narratable place.
 */

export interface PlaceKind {
  kind: string;
  category: string;
  score: number;
}

interface Rule {
  test: RegExp;
  kind: string;
  category: string;
  score: number;
}

// A site is recognised before the fossil/person filters run: "fossil-bearing
// site" is somewhere to stand, while "hominin fossil" is a specimen.
const SITE =
  /\b(archaeological site|paleontological site|palaeontological site|fossil site|fossil-bearing site|world heritage site)\b/i;

// Things that sit on a map but are not places to tour: battles, disasters,
// elections. "Battle of Saldanha Bay" is not a bay.
const EVENTS = new RegExp(
  [
    '^(\\d{4}\\b)',
    '\\b(timeline of|list of|history of|inauguration of)\\b',
    '\\b(battle|siege|massacre|shooting|stabbing|slashing|murder|assassination|bombing|riot|protest|election|referendum|earthquake|flood|wildfire|crash|derailment|disaster|epidemic|pandemic|outbreak)\\b',
    '\\b(album|film|novel|song|band|video game|television series)\\b',
    '\\b(tournament|championship|competition|grand prix|cup final|world cup|league season|season of|edition of)\\b',
    '\\b(company|airline|newspaper|magazine|political party|football club|rugby union team|cricket team|record label)\\b',
    // Not somewhere to stand: a body, a meeting, a charity.
    '\\b(organization|organisation|nonprofit|non-profit|foundation|research unit|institute|meeting|conference)\\b',
  ].join('|'),
  'i',
);

// A specimen or a person is not a place. Only the head of a description is
// checked, so "nature reserve protecting species" keeps its reserve.
const SPECIMEN =
  /\b(fossil|hominin|hominid|skeleton|species|genus|subspecies|racehorse|shipwreck|actor|actress|politician|singer|songwriter|writer|poet|author|footballer|cricketer|businessman|artist|painter|composer|born)\b/i;

// Regions are too wide to be "700 metres ahead"; they are skipped on purpose.
const TOO_BIG = /\b(local municipality|municipality|district|province|region|colony|republic|country|continent)\b/i;

// Descriptions are type-first, so "town in the Western Cape" is a town while
// "park in Cape Town" is not. Anchoring at the start keeps that distinction.
const SETTLEMENT_LEAD =
  /^\s*(city|town|township|village|hamlet|human settlement|settlement|suburb|neighbourhood|neighborhood|locality|place(?! of)|seat of government|dorpie)\b/i;

const SETTLEMENTS: Record<string, PlaceKind> = {
  city: { kind: 'city', category: 'place', score: 88 },
  town: { kind: 'town', category: 'place', score: 84 },
  township: { kind: 'township', category: 'place', score: 82 },
  village: { kind: 'village', category: 'place', score: 80 },
  hamlet: { kind: 'hamlet', category: 'place', score: 76 },
  'seat of government': { kind: 'town', category: 'place', score: 76 },
  'human settlement': { kind: 'settlement', category: 'place', score: 72 },
  settlement: { kind: 'settlement', category: 'place', score: 72 },
  dorpie: { kind: 'village', category: 'place', score: 78 },
  suburb: { kind: 'suburb', category: 'place', score: 66 },
  neighbourhood: { kind: 'suburb', category: 'place', score: 66 },
  neighborhood: { kind: 'suburb', category: 'place', score: 66 },
  locality: { kind: 'locality', category: 'place', score: 62 },
  // "place in Gauteng" is Wikidata's wording for a populated place, which is
  // a settlement: vague, but not the nothing of "It's a place"
  place: { kind: 'settlement', category: 'place', score: 68 },
};

// Checked in order, so the most specific description wins: a "naval base" is a
// military site before it is a harbour, and a "fossil site" is handled above.
const RULES: Rule[] = [
  { test: /\b(dam|reservoir)\b/i, kind: 'dam', category: 'waterway', score: 94 },
  { test: /\blighthouse\b/i, kind: 'lighthouse', category: 'man_made', score: 91 },
  { test: /\b(castle|fortress|citadel)\b/i, kind: 'castle', category: 'historic', score: 90 },
  { test: /\b(naval base|naval station|airbase|air base|military base|military installation)\b/i, kind: 'military base', category: 'historic', score: 78 },
  { test: /\b(fort|blockhouse)\b/i, kind: 'fort', category: 'historic', score: 84 },
  { test: /\bmonument\b/i, kind: 'monument', category: 'historic', score: 88 },
  { test: /\b(battlefield)\b/i, kind: 'battlefield', category: 'historic', score: 86 },
  { test: /\b(ruins?|archaeological|paleontological|palaeontological)\b/i, kind: 'ruins', category: 'historic', score: 84 },
  { test: /\bfind spot\b/i, kind: 'archaeological site', category: 'historic', score: 76 },
  { test: /\b(historic site|heritage site|concentration camp)\b/i, kind: 'historic site', category: 'historic', score: 80 },
  { test: /\b(memorial|statue|obelisk)\b/i, kind: 'memorial', category: 'historic', score: 82 },
  { test: /\bmuseum\b/i, kind: 'museum', category: 'tourism', score: 86 },
  { test: /\b(gallery|art centre|art center)\b/i, kind: 'gallery', category: 'tourism', score: 74 },
  { test: /\b(bridge|viaduct)\b/i, kind: 'bridge', category: 'man_made', score: 84 },
  { test: /\bcathedral\b/i, kind: 'cathedral', category: 'amenity', score: 82 },
  { test: /\b(basilica)\b/i, kind: 'cathedral', category: 'amenity', score: 80 },
  { test: /\b(place of worship|church|chapel|mosque|synagogue|temple|minster|kathedraal|kerk)\b/i, kind: 'place of worship', category: 'amenity', score: 72 },
  { test: /\buniversity\b/i, kind: 'university', category: 'education', score: 78 },
  { test: /\bcollege\b/i, kind: 'college', category: 'education', score: 72 },
  { test: /\b(school|hoërskool|high school|primary school|madrasa|madrasah)\b/i, kind: 'school', category: 'education', score: 56 },
  { test: /\b(airport|aerodrome|airfield|airstrip)\b/i, kind: 'airport', category: 'transport', score: 78 },
  { test: /\b(railway station|train station|railway halt)\b/i, kind: 'station', category: 'transport', score: 62 },
  { test: /\b(street|avenue|boulevard)\b/i, kind: 'street', category: 'transport', score: 64 },
  { test: /\b(harbour|harbor|port|dock|marina|jetty|pier|wharf)\b/i, kind: 'harbour', category: 'transport', score: 76 },
  { test: /\b(stadium|arena|sports ground|sports stadium)\b/i, kind: 'stadium', category: 'leisure', score: 66 },
  { test: /\bgolf course\b/i, kind: 'golf course', category: 'leisure', score: 60 },
  { test: /\b(prison|gaol|jail|detention cent(er|re))\b/i, kind: 'prison', category: 'amenity', score: 54 },
  { test: /\b(cemetery|graveyard|burial ground)\b/i, kind: 'cemetery', category: 'landuse', score: 60 },
  { test: /\b(theatre|theater|opera house|concert hall|amphitheatre)\b/i, kind: 'theatre', category: 'amenity', score: 74 },
  { test: /\blibrary\b/i, kind: 'library', category: 'amenity', score: 58 },
  // "section of Soweto township" is a suburb-sized part of a bigger place.
  { test: /^section of\b/i, kind: 'suburb', category: 'place', score: 66 },
  { test: /\bhospital\b/i, kind: 'hospital', category: 'amenity', score: 54 },
  // Clinics are the single largest group of vague South African records.
  { test: /\bclinic\b/i, kind: 'clinic', category: 'amenity', score: 44 },
  { test: /\b(hotel|resort|guest house|lodge)\b/i, kind: 'hotel', category: 'tourism', score: 54 },
  { test: /\b(marketplace|market|flea market)\b/i, kind: 'marketplace', category: 'amenity', score: 60 },
  { test: /\b(town hall|city hall|townhall|municipal offices)\b/i, kind: 'town hall', category: 'amenity', score: 66 },
  { test: /\b(quarry)\b/i, kind: 'quarry', category: 'landuse', score: 68 },
  { test: /\b(mine|mining|colliery|gold mine|diamond mine)\b/i, kind: 'mine', category: 'landuse', score: 74 },
  { test: /\b(power station|power plant|refinery|factory|smokestack)\b/i, kind: 'industrial site', category: 'landuse', score: 62 },
  { test: /\b(wine estate|wine farm|vineyard|wine route)\b/i, kind: 'wine estate', category: 'landuse', score: 76 },
  { test: /\b(farm|farmstead|smallholding|estate|plantation)\b/i, kind: 'farm', category: 'landuse', score: 68 },
  { test: /\b(nature reserve|game reserve|protected area|national park|conservancy|wilderness area|marine protected area)\b/i, kind: 'nature reserve', category: 'leisure', score: 80 },
  { test: /\b(botanical garden|botanical reserve)\b/i, kind: 'botanical garden', category: 'leisure', score: 78 },
  { test: /\b(island)\b/i, kind: 'island', category: 'natural', score: 80 },
  // "cape" is left out on purpose: "Western Cape" is a province, not a headland.
  { test: /\b(peninsula|headland)\b/i, kind: 'peninsula', category: 'natural', score: 74 },
  { test: /\b(beach|coastline|shoreline|dune)\b/i, kind: 'beach', category: 'natural', score: 68 },
  { test: /\b(bay|lagoon|estuary|inlet|gulf)\b/i, kind: 'bay', category: 'natural', score: 78 },
  { test: /\b(river|stream|spruit|tributary)\b/i, kind: 'river', category: 'natural', score: 72 },
  { test: /\b(waterfall|falls|cascade)\b/i, kind: 'waterfall', category: 'natural', score: 74 },
  { test: /\b(spring|fountain)\b/i, kind: 'spring', category: 'natural', score: 58 },
  { test: /\b(wetland|vlei|marsh|pan)\b/i, kind: 'wetland', category: 'natural', score: 66 },
  { test: /\b(mountain range|range of mountains|mountains|mountain|peak|summit|koppie|kopje|butte|mesa)\b/i, kind: 'mountain', category: 'natural', score: 80 },
  { test: /\b(hill|ridge|escarpment|cliff|kop)\b/i, kind: 'hill', category: 'natural', score: 66 },
  { test: /\b(pass|poort|gorge|kloof|ravine|valley|nek)\b/i, kind: 'pass', category: 'natural', score: 74 },
  { test: /\b(cave|cavern|grotto|sinkhole)\b/i, kind: 'cave', category: 'natural', score: 74 },
  { test: /\b(forest|woodland|grove|nature area)\b/i, kind: 'forest', category: 'natural', score: 60 },
  { test: /\b(park|garden|square|plaza|common|parkland)\b/i, kind: 'park', category: 'leisure', score: 62 },
  { test: /\b(tower|water tower|observation tower)\b/i, kind: 'tower', category: 'man_made', score: 76 },
  { test: /\bpump ?house\b/i, kind: 'pumphouse', category: 'man_made', score: 56 },
  { test: /\b(windmill|watermill)\b/i, kind: 'windmill', category: 'man_made', score: 78 },
  { test: /\b(architectural structure|building|skyscraper|office block|complex)\b/i, kind: 'building', category: 'man_made', score: 58 },
  { test: /\b(home|house|homestead|cottage|villa)\b/i, kind: 'historic house', category: 'historic', score: 68 },
  { test: /\b(road pass|mountain pass|national road|highway)\b/i, kind: 'pass', category: 'transport', score: 70 },
];

// Names carry their own clues, especially in South Africa: a "kop" is a hill and
// a "poort" is a pass even when the article has no description at all.
const NAME_SUFFIXES: { test: RegExp; kind: string; category: string; score: number }[] = [
  { test: /(poort|nek)$/i, kind: 'pass', category: 'natural', score: 72 },
  { test: /(baai)$/i, kind: 'bay', category: 'natural', score: 76 },
  { test: /(eiland)$/i, kind: 'island', category: 'natural', score: 78 },
  { test: /(rivier)$/i, kind: 'river', category: 'natural', score: 70 },
  { test: /(spruit)$/i, kind: 'river', category: 'natural', score: 68 },
  { test: /(dam)$/i, kind: 'dam', category: 'waterway', score: 88 },
  { test: /(kerk)$/i, kind: 'place of worship', category: 'amenity', score: 70 },
  { test: /(plein)$/i, kind: 'park', category: 'leisure', score: 64 },
  { test: /(kop|koppie|koppies|berg|berge|rand|rant|bult|heuwel)$/i, kind: 'hill', category: 'natural', score: 66 },
];

// Words specific enough to trust in a bare article title (no description).
const TITLE_RULES: Rule[] = RULES.filter((rule) =>
  /\b(dam|reservoir|lighthouse|castle|monument|memorial|statue|battlefield|museum|bridge|cathedral|church|chapel|mosque|temple|university|airport|aerodrome|harbour|port|stadium|theatre|quarry|mine|nature reserve|game reserve|botanical garden|island|bay|river|waterfall|mountain|peak|pass|gorge|cave|forest|tower|windmill|wine estate|vineyard|street|house|homestead|clinic|farm|find spot|historic site)\b/i.test(
    rule.test.source,
  ),
);

function settlementLead(text: string): PlaceKind | null {
  const match = SETTLEMENT_LEAD.exec(text);
  if (!match) return null;
  return SETTLEMENTS[match[1].toLowerCase().replace(/\s+/g, ' ')] ?? null;
}

function fromRules(text: string, rules: Rule[]): PlaceKind | null {
  for (const rule of rules) {
    if (rule.test.test(text)) {
      return { kind: rule.kind, category: rule.category, score: rule.score };
    }
  }
  return null;
}

// A school is named, not described, in many South African records.
const NAME_PREFIXES: { test: RegExp; kind: string; category: string; score: number }[] = [
  { test: /^(ho[eë]rskool|laerskool|high school|primary school|secondary school)\b/i, kind: 'school', category: 'education', score: 54 },
  { test: /^(ho[eë]r tegniese skool|technical high school)\b/i, kind: 'school', category: 'education', score: 54 },
  { test: /^ng gemeente\b/i, kind: 'place of worship', category: 'amenity', score: 60 },
];

// A description like "clinic in Gauteng" names its own type even when no rule
// covers it, and that leading noun is far better than the word "place".
const GENERIC_PHRASE = /^([a-z][a-z' -]{2,28}?)\s+(?:in|of|near)\s+/i;
const GENERIC_WORDS = new Set([
  'place',
  'area',
  'site',
  'location',
  'thing',
  'structure',
  'object',
  'part',
  'section',
  'list',
  'form',
  'type',
  'group',
  'series',
  'event',
]);
// Words that are plural but name one place.
const PLURAL_OK = new Set(['falls', 'ruins', 'gardens', 'works', 'springs']);

function genericKind(desc: string): PlaceKind | null {
  const match = GENERIC_PHRASE.exec(desc);
  if (!match) return null;
  const phrase = match[1].trim().toLowerCase();
  const words = phrase.split(/\s+/);
  if (words.length === 0 || words.length > 3) return null;
  if (EVENTS.test(phrase) || SPECIMEN.test(phrase)) return null;
  if (words.some((word) => GENERIC_WORDS.has(word))) return null;
  if (words[0] === 'former' || words[0] === 'old' || words[0] === 'the') return null;
  // "shops in ..." would be spoken as "a shops", so plurals are not used.
  if (/s$/.test(phrase) && !PLURAL_OK.has(phrase)) return null;
  return { kind: phrase, category: 'place', score: 58 };
}

function fromNameSuffix(name: string): PlaceKind | null {
  const trimmed = name.trim();
  for (const rule of NAME_PREFIXES) {
    if (rule.test.test(trimmed)) {
      return { kind: rule.kind, category: rule.category, score: rule.score };
    }
  }
  const lastWord = trimmed.split(/\s+/).pop() ?? '';
  for (const rule of NAME_SUFFIXES) {
    if (rule.test.test(lastWord)) {
      return { kind: rule.kind, category: rule.category, score: rule.score };
    }
  }
  return null;
}

/**
 * Classify a place from its short description and, where needed, its name.
 * Returns null for anything that is not somewhere you can drive past.
 */
export function classifyPlace(description: string, name: string): PlaceKind | null {
  const desc = (description ?? '').trim();
  const title = (name ?? '').trim();

  const heading = desc.split(/\s+/).slice(0, 3).join(' ');

  if (desc) {
    if (SITE.test(desc)) return { kind: 'archaeological site', category: 'historic', score: 88 };
    if (EVENTS.test(desc) || SPECIMEN.test(heading)) return null;
    const settled = settlementLead(desc);
    if (settled) return settled;
    const ruled = fromRules(desc, RULES);
    if (ruled) {
      // A description that says only "building" is beaten by the name itself:
      // the Hector Pieterson Memorial is a memorial, not just a structure.
      if (ruled.kind === 'building') {
        const named = fromNameSuffix(title) ?? fromRules(title, TITLE_RULES);
        if (named && named.score > ruled.score) return named;
      }
      return ruled;
    }
    if (TOO_BIG.test(desc)) return null;
    const generic = genericKind(desc);
    if (generic) return generic;
  }

  if (EVENTS.test(title) || SPECIMEN.test(title)) return null;

  // The name's own ending is the stronger clue: "Castle Koppies" is a hill.
  const named = fromNameSuffix(title) ?? fromRules(title, TITLE_RULES);
  if (named) return named;

  // A real article about a real place is still worth a pin even when its type
  // is vague: it can be tapped, and its story is fetched. The low score keeps
  // it out of the automatic tour, and narration drops the "It's a place" line.
  if (desc) return { kind: 'place', category: 'place', score: 56 };
  return null;
}

/** True when a bare title looks like a numbered Wikidata item, not a name. */
export function isPlaceholderName(name: string): boolean {
  return /^Q\d+$/.test(name.trim());
}
