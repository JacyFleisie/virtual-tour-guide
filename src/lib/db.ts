import * as SQLite from 'expo-sqlite';
import { haversine } from './geo';

export interface CachedPoi {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
  summary: string | null;
  image: string | null;
  title: string | null;
  fetched_at: number;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('tourguide.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS pois (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT,
          kind TEXT,
          lat REAL,
          lng REAL,
          summary TEXT,
          image TEXT,
          title TEXT,
          fetched_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS narrated (
          poi_id TEXT PRIMARY KEY NOT NULL,
          at INTEGER,
          lat REAL,
          lng REAL
        );
      `);
      return db;
    })();
  }
  return dbPromise;
}

export async function initDb(): Promise<void> {
  await getDb();
}

export async function getCachedPoi(id: string): Promise<CachedPoi | null> {
  const db = await getDb();
  return db.getFirstAsync<CachedPoi>('SELECT * FROM pois WHERE id = ?', id);
}

export async function putCachedPoi(poi: CachedPoi): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO pois (id, name, kind, lat, lng, summary, image, title, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    poi.id,
    poi.name,
    poi.kind,
    poi.lat,
    poi.lng,
    poi.summary,
    poi.image,
    poi.title,
    poi.fetched_at,
  );
}

export async function markNarrated(id: string, lat: number, lng: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO narrated (poi_id, at, lat, lng) VALUES (?, ?, ?, ?)',
    id,
    Date.now(),
    lat,
    lng,
  );
}

/**
 * True when this place was narrated within `withinMs`, or when we already
 * narrated it from a spot close to the current one (so a round trip does not
 * repeat the same story).
 */
export async function wasNarratedRecently(
  id: string,
  lat: number,
  lng: number,
  withinMs = 60 * 60 * 1000,
  withinMeters = 800,
): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ at: number; lat: number; lng: number }>(
    'SELECT at, lat, lng FROM narrated WHERE poi_id = ?',
    id,
  );
  if (!row) return false;
  if (Date.now() - (row.at ?? 0) < withinMs) return true;
  if (Number.isFinite(row.lat) && Number.isFinite(row.lng)) {
    if (haversine(lat, lng, row.lat, row.lng) < withinMeters) return true;
  }
  return false;
}
