export interface Poi {
  id: string;
  name: string;
  kind: string;
  category: string;
  lat: number;
  lng: number;
  interest: number;
  wikipedia?: string;
  image?: string | null;
  source?: 'wikipedia' | 'wikivoyage' | 'wikidata' | 'osm';
  /** One-line type/location note from the source, used when no article exists. */
  note?: string | null;
}

export interface PoiWithDistance extends Poi {
  distance: number;
}

export interface GeoPosition {
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
}

export interface NarrationCard {
  poiId: string;
  title: string;
  kind: string;
  text: string;
  image: string | null;
  at: number;
}

export interface LatLng {
  lat: number;
  lng: number;
}
