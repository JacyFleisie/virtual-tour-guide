import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import { GeoPosition, LatLng, Poi } from '../types';
import { poiIcon } from '../lib/icons';

export interface TourMapHandle {
  focusPoi: (id: string) => void;
}

interface TourMapProps {
  position: GeoPosition | null;
  trail: LatLng[];
  pois: Poi[];
  follow: boolean;
  onPoiTap: (id: string) => void;
}

function buildHtml(centerLat: number, centerLng: number): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: #0b1220; }
  .leaflet-container { background: #0b1220; font-family: -apple-system, Roboto, sans-serif; }
  .me-dot { width: 18px; height: 18px; border-radius: 50%; background: #38bdf8; border: 3px solid #ffffff; box-shadow: 0 0 0 0 rgba(56,189,248,0.7); animation: pulse 2s infinite; }
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(56,189,248,0.7); }
    70% { box-shadow: 0 0 0 18px rgba(56,189,248,0); }
    100% { box-shadow: 0 0 0 0 rgba(56,189,248,0); }
  }
  .poi-pin { width: 30px; height: 30px; border-radius: 50%; background: #1e293b; border: 2px solid #f59e0b; display: flex; align-items: center; justify-content: center; font-size: 15px; box-shadow: 0 2px 6px rgba(0,0,0,0.5); }
  .leaflet-popup-content-wrapper { background: #0f172a; color: #e2e8f0; border-radius: 12px; }
  .leaflet-popup-tip { background: #0f172a; }
  .leaflet-popup-content { margin: 10px 12px; font-size: 13px; }
  .popup-title { font-weight: 700; font-size: 14px; margin-bottom: 2px; }
  .popup-kind { color: #94a3b8; text-transform: capitalize; font-size: 11px; }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var START = [${centerLat}, ${centerLng}];
  var map = L.map('map', { zoomControl: false, attributionControl: true }).setView(START, 15);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  var trail = L.polyline([], { color: '#38bdf8', weight: 5, opacity: 0.65 }).addTo(map);
  var poiLayer = L.layerGroup().addTo(map);
  var meMarker = null;
  var markerById = {};
  var firstFix = true;
  var follow = true;

  function post(obj) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(obj));
    }
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  window.setPos = function (lat, lng, accuracy, heading) {
    if (meMarker === null) {
      meMarker = L.marker([lat, lng], {
        icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
        interactive: false
      }).addTo(map);
    } else {
      meMarker.setLatLng([lat, lng]);
    }
    if (firstFix || follow) {
      map.setView([lat, lng], Math.max(map.getZoom(), 15));
      firstFix = false;
    }
  };

  window.setFollow = function (value) {
    follow = !!value;
    if (follow && meMarker) {
      map.setView(meMarker.getLatLng(), Math.max(map.getZoom(), 15));
    }
  };

  window.setTrail = function (points) {
    trail.setLatLngs(points || []);
  };

  window.setPois = function (list) {
    poiLayer.clearLayers();
    markerById = {};
    (list || []).forEach(function (p) {
      var marker = L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          className: '',
          html: '<div class="poi-pin">' + esc(p.icon) + '</div>',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      });
      marker.bindPopup(
        '<div class="popup-title">' + esc(p.name) + '</div>' +
        '<div class="popup-kind">' + esc(p.kind) + '</div>'
      );
      marker.on('click', function () { post({ type: 'poiTap', id: p.id }); });
      marker.addTo(poiLayer);
      markerById[p.id] = marker;
    });
  };

  window.focusPoi = function (id) {
    var marker = markerById[id];
    if (marker) {
      map.setView(marker.getLatLng(), 17);
      marker.openPopup();
    }
  };

  map.whenReady(function () { post({ type: 'ready' }); });
</script>
</body>
</html>`;
}

const DEFAULT_CENTER = { lat: 20, lng: 0 };

export const TourMap = forwardRef<TourMapHandle, TourMapProps>(function TourMap(
  { position, trail, pois, follow, onPoiTap },
  ref,
) {
  const webRef = useRef<WebView<{}>>(null);
  const [ready, setReady] = useState(false);

  const html = useMemo(
    () => buildHtml(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
    [],
  );

  const inject = useCallback((code: string) => {
    webRef.current?.injectJavaScript(`${code}\ntrue;`);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focusPoi: (id: string) => inject(`window.focusPoi(${JSON.stringify(id)});`),
    }),
    [inject],
  );

  useEffect(() => {
    if (!ready || !position) return;
    inject(
      `window.setPos(${position.lat}, ${position.lng}, ${position.accuracy ?? 0}, ${
        position.heading ?? 0
      });`,
    );
  }, [ready, position, inject]);

  useEffect(() => {
    if (!ready) return;
    inject(`window.setTrail(${JSON.stringify(trail)});`);
  }, [ready, trail, inject]);

  const poiPayload = useMemo(
    () => pois.map((poi) => ({ ...poi, icon: poiIcon(poi.kind) })),
    [pois],
  );

  useEffect(() => {
    if (!ready) return;
    inject(`window.setPois(${JSON.stringify(poiPayload)});`);
  }, [ready, poiPayload, inject]);

  useEffect(() => {
    if (!ready) return;
    inject(`window.setFollow(${follow ? 'true' : 'false'});`);
  }, [ready, follow, inject]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const message = JSON.parse(event.nativeEvent.data) as {
          type?: string;
          id?: string;
        };
        if (message.type === 'ready') setReady(true);
        else if (message.type === 'poiTap' && message.id) onPoiTap(message.id);
      } catch {
        // ignore malformed messages
      }
    },
    [onPoiTap],
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <WebView<{}>
        ref={webRef}
        source={{ html }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        onMessage={handleMessage}
        style={styles.web}
        containerStyle={styles.web}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#0b1220' },
});
