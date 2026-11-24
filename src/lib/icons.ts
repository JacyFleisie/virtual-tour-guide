const ICONS: Record<string, string> = {
  dam: '🌊',
  weir: '🌊',
  bridge: '🌉',
  'historic bridge': '🌉',
  monument: '🗿',
  castle: '🏰',
  fort: '🏯',
  ruins: '🏚️',
  'archaeological site': '🏺',
  battlefield: '⚔️',
  memorial: '🕯️',
  museum: '🏛️',
  gallery: '🖼️',
  lighthouse: '🗼',
  tower: '🗼',
  'historic tower': '🗼',
  'water tower': '💧',
  windmill: '🌬️',
  watermill: '⚙️',
  viewpoint: '👀',
  park: '🌳',
  garden: '🌷',
  'nature reserve': '🌲',
  peak: '⛰️',
  beach: '🏖️',
  cave: '🕳️',
  spring: '💧',
  zoo: '🦓',
  aquarium: '🐠',
  'theme park': '🎢',
  theatre: '🎭',
  'place of worship': '⛪',
  library: '📚',
  'town hall': '🏛️',
  marketplace: '🛒',
  attraction: '⭐',
  artwork: '🎨',
  'city gate': '🚪',
  'manor house': '🏡',
  'historic church': '⛪',
  'historic well': '🪣',
  'wayside cross': '✝️',
  'historic site': '🏛️',
  obelisk: '🗿',
  pier: '⚓',
  chimney: '🏭',
  mast: '📡',
};

export function poiIcon(kind: string): string {
  return ICONS[kind] ?? '📍';
}

// One accent per kind of place, so the map reads as a legend at a glance: water
// is blue, parks green, history amber, museums coral, and so on.
const ACCENTS: Record<string, string> = {
  historic: '#d99a4e',
  waterway: '#4d9ad4',
  man_made: '#9b8ae0',
  tourism: '#e2826b',
  leisure: '#5cad7f',
  amenity: '#b98ad0',
  transport: '#8496aa',
  education: '#8496aa',
};

const KIND_ACCENTS: Record<string, string> = {
  dam: '#4d9ad4',
  weir: '#4d9ad4',
  canal: '#4d9ad4',
  lighthouse: '#e0b34e',
  museum: '#e2826b',
  'place of worship': '#b98ad0',
  park: '#5cad7f',
  garden: '#5cad7f',
};

export function poiAccent(category: string, kind: string): string {
  return KIND_ACCENTS[kind] ?? ACCENTS[category] ?? '#d99a4e';
}
