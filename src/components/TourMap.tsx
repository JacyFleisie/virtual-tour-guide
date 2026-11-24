import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import { GeoPosition, LatLng, Poi } from '../types';
import { poiAccent, poiIcon } from '../lib/icons';

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

  /* My position: a soft floating beacon rather than a plain dot. */
  .me { position: relative; width: 30px; height: 30px; }
  .me .halo {
    position: absolute; inset: 0; border-radius: 50%;
    background: rgba(56, 189, 248, 0.35);
    animation: pulse 2.4s ease-out infinite;
  }
  .me .dot {
    position: absolute; inset: 5px; border-radius: 50%;
    background: #38bdf8; border: 3px solid #ffffff;
    box-shadow: 0 2px 6px rgba(2, 6, 23, 0.55);
  }
  @keyframes pulse {
    0% { transform: scale(0.6); opacity: 0.9; }
    70% { transform: scale(1.5); opacity: 0; }
    100% { transform: scale(1.5); opacity: 0; }
  }

  /* Place pins: a round medallion of the place itself, on a small pointer. */
  .pin { position: relative; width: 40px; height: 50px; filter: drop-shadow(0 3px 4px rgba(2, 6, 23, 0.45)); }
  .pin .head {
    position: absolute; top: 0; left: 0; width: 40px; height: 40px;
    border-radius: 50%; background: var(--accent, #e6a75c);
    border: 2.5px solid #ffffff; box-sizing: border-box;
    overflow: hidden; display: flex; align-items: center; justify-content: center;
  }
  .pin .head::after {
    content: ''; position: absolute; inset: 0; border-radius: 50%;
    box-shadow: inset 0 -7px 12px rgba(2, 6, 23, 0.22); pointer-events: none;
  }
  .pin .glyph { font-size: 18px; line-height: 1; }
  .pin .photo {
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; display: block;
  }
  .pin .tip {
    position: absolute; top: 34px; left: 50%; margin-left: -8px;
    width: 0; height: 0;
    border-left: 8px solid transparent; border-right: 8px solid transparent;
    border-top: 14px solid #ffffff;
  }
  .pin .tip::after {
    content: ''; position: absolute; top: -14px; left: -5px;
    width: 0; height: 0;
    border-left: 5px solid transparent; border-right: 5px solid transparent;
    border-top: 9px solid var(--accent, #e6a75c);
  }

  /* Close pins share one bubble until you zoom in far enough to tell them apart. */
  .cluster {
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%; background: rgba(11, 18, 32, 0.92); color: #f8fafc;
    font-weight: 700; border: 2.5px solid var(--accent, #7dd3fc);
    box-shadow: 0 4px 10px rgba(2, 6, 23, 0.5);
  }

  /* Popup: photo first, then the name, on the app's dark card. */
  .leaflet-popup-content-wrapper {
    background: #0f172a; color: #e2e8f0; border-radius: 14px;
    box-shadow: 0 12px 28px rgba(2, 6, 23, 0.55);
  }
  .leaflet-popup-tip { background: #0f172a; }
  .leaflet-popup-content { margin: 10px; width: 168px !important; }
  .popup-photo {
    display: block; width: 100%; height: 105px; object-fit: cover;
    border-radius: 9px; margin-bottom: 8px; background: #1e293b;
  }
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

  function pinHtml(p) {
    var head = '<div class="head">';
    head += '<span class="glyph">' + esc(p.icon) + '</span>';
    if (p.image) {
      // The emoji sits behind the photo: if the picture fails to load, the pin
      // still reads as a place instead of showing an empty ring.
      head += '<img class="photo" src="' + esc(p.image) + '" alt="" onerror="this.style.display=\\'none\\'" />';
    }
    head += '</div>';
    return '<div class="pin" style="--accent:' + esc(p.accent) + '">' + head + '<div class="tip"></div></div>';
  }

  window.setPos = function (lat, lng, accuracy, heading) {
    if (meMarker === null) {
      meMarker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: '',
          html: '<div class="me"><div class="halo"></div><div class="dot"></div></div>',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        }),
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

  var poiList = [];

  function popupHtml(p) {
    var popup = '';
    if (p.image) {
      popup += '<img class="popup-photo" src="' + esc(p.image) + '" alt="" onerror="this.style.display=\\'none\\'" />';
    }
    popup += '<div class="popup-title">' + esc(p.name) + '</div>' +
      '<div class="popup-kind">' + esc(p.kind) + '</div>';
    return popup;
  }

  function addPin(p) {
    var marker = L.marker([p.lat, p.lng], {
      icon: L.divIcon({
        className: '',
        html: pinHtml(p),
        iconSize: [40, 50],
        iconAnchor: [20, 48]
      })
    });
    marker.bindPopup(popupHtml(p), { maxWidth: 200, minWidth: 168 });
    marker.on('click', function () { post({ type: 'poiTap', id: p.id }); });
    marker.addTo(poiLayer);
    markerById[p.id] = marker;
  }

  function clusterIcon(count, accent) {
    var size = count < 10 ? 34 : count < 30 ? 40 : 46;
    return L.divIcon({
      className: '',
      html: '<div class="cluster" style="width:' + size + 'px;height:' + size +
        'px;font-size:' + (size < 40 ? 13 : 15) + 'px;--accent:' + esc(accent) + '">' +
        count + '</div>',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });
  }

  // A town centre has more landmarks than pixels, so nearby places share a
  // numbered bubble until the driver zooms in, instead of stacking photos.
  function renderPins() {
    poiLayer.clearLayers();
    markerById = {};
    var zoom = map.getZoom();
    if (zoom >= 17) {
      poiList.forEach(addPin);
      return;
    }

    var cell = 52;
    var groups = {};
    poiList.forEach(function (p) {
      var point = map.project([p.lat, p.lng], zoom);
      var key = Math.floor(point.x / cell) + '|' + Math.floor(point.y / cell);
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });

    Object.keys(groups).forEach(function (key) {
      var group = groups[key];
      if (group.length === 1) {
        addPin(group[0]);
        return;
      }
      var lat = 0;
      var lng = 0;
      var best = group[0];
      group.forEach(function (p) {
        lat += p.lat;
        lng += p.lng;
        if (p.interest > best.interest) best = p;
      });
      lat /= group.length;
      lng /= group.length;
      L.marker([lat, lng], {
        icon: clusterIcon(group.length, best.accent),
        title: group.length + ' places'
      })
        .on('click', function () {
          map.setView([lat, lng], Math.min(18, zoom + 2));
        })
        .addTo(poiLayer);
    });
  }

  window.setPois = function (list) {
    poiList = list || [];
    renderPins();
  };

  map.on('zoomend', renderPins);

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
    () =>
      pois.map((poi) => ({
        ...poi,
        icon: poiIcon(poi.kind),
        accent: poiAccent(poi.category, poi.kind),
        image: poi.image ?? null,
      })),
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
