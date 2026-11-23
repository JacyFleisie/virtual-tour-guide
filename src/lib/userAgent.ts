/**
 * Wikimedia and Overpass reject requests that use a generic HTTP client
 * User-Agent (React Native's default "okhttp/…" gets a 403). Every outbound
 * request from the app identifies itself with this instead.
 */
export const USER_AGENT = 'VirtualTourGuide/1.0 (Android; free open-data tour app)';
