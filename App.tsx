import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { TourMap, TourMapHandle } from './src/components/TourMap';
import { useTourGuide } from './src/hooks/useTourGuide';
import { formatDistance } from './src/lib/geo';
import { poiIcon } from './src/lib/icons';
import { hasSeenIntro, markIntroSeen } from './src/lib/settings';

const TOP_PAD = Platform.OS === 'android' ? 48 : 56;

export default function App() {
  const {
    permission,
    tracking,
    error,
    notice,
    position,
    trail,
    pois,
    nearby,
    nowPlaying,
    settings,
    fetching,
    narrate,
    tellMeNearest,
    repeatLast,
    toggleMute,
    toggleAuto,
    toggleFollow,
    enableBackgroundTracking,
    openSettings,
  } = useTourGuide();

  const mapRef = useRef<TourMapHandle>(null);
  const [showIntro, setShowIntro] = useState(false);

  useEffect(() => {
    hasSeenIntro().then((seen) => {
      if (!seen) setShowIntro(true);
    });
  }, []);

  const dismissIntro = () => {
    setShowIntro(false);
    void markIntroSeen();
  };

  const speedKmh =
    position?.speed != null ? Math.round(Math.max(0, position.speed) * 3.6) : null;
  const accuracyText =
    position?.accuracy != null ? `±${Math.round(position.accuracy)} m` : 'locating…';

  const openPoi = (id: string, poi: (typeof pois)[number]) => {
    mapRef.current?.focusPoi(id);
    void narrate(poi);
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <TourMap
        ref={mapRef}
        position={position}
        trail={trail}
        pois={pois}
        follow={settings.follow}
        onPoiTap={(id) => {
          const poi = pois.find((item) => item.id === id);
          if (poi) void narrate(poi);
        }}
      />

      <View style={[styles.top, { paddingTop: TOP_PAD }]} pointerEvents="box-none">
        <View style={styles.statusRow}>
          <View style={styles.pill}>
            <Text style={styles.pillText}>📍 {accuracyText}</Text>
          </View>
          {speedKmh !== null && (
            <View style={styles.pill}>
              <Text style={styles.pillText}>🚗 {speedKmh} km/h</Text>
            </View>
          )}
          <View style={styles.pill}>
            <Text style={styles.pillText}>🏛️ {pois.length}</Text>
          </View>
          <Pressable
            onPress={toggleFollow}
            style={[styles.pill, settings.follow && styles.pillActive]}
          >
            <Text style={styles.pillText}>🎯 {settings.follow ? 'Following' : 'Free'}</Text>
          </Pressable>
          <Pressable
            onPress={tracking === 'foreground' ? enableBackgroundTracking : undefined}
            style={[styles.pill, tracking === 'background' && styles.pillActive]}
          >
            <Text style={styles.pillText}>
              {tracking === 'background'
                ? '🛰️ Background'
                : tracking === 'foreground'
                  ? '📱 Screen on · fix'
                  : '⏳ Starting'}
            </Text>
          </Pressable>
          {fetching && <ActivityIndicator size="small" color="#38bdf8" />}
        </View>

        {notice && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        )}
        {permission === 'denied' && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>
              {error ?? 'Location permission denied.'} Enable it in system settings to
              start the tour.
            </Text>
            <Pressable style={styles.bannerButton} onPress={openSettings}>
              <Text style={styles.bannerButtonText}>Open settings</Text>
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.bottom} pointerEvents="box-none">
        {nowPlaying ? (
          <View style={styles.card}>
            <Text style={styles.cardKind}>{nowPlaying.kind}</Text>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {nowPlaying.title}
            </Text>
            <Text style={styles.cardText} numberOfLines={3}>
              {nowPlaying.text}
            </Text>
          </View>
        ) : (
          <View style={styles.hintCard}>
            <Text style={styles.hintText}>
              Live tour ready. Start driving and I&apos;ll tell you about the landmarks
              you pass.
            </Text>
          </View>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsRow}
          contentContainerStyle={styles.chips}
        >
          {nearby.slice(0, 12).map((poi) => (
            <Pressable
              key={poi.id}
              style={styles.chip}
              onPress={() => openPoi(poi.id, poi)}
            >
              <Text style={styles.chipIcon}>{poiIcon(poi.kind)}</Text>
              <View style={styles.chipBody}>
                <Text style={styles.chipName} numberOfLines={1}>
                  {poi.name}
                </Text>
                <Text style={styles.chipMeta} numberOfLines={1}>
                  {poi.kind} · {formatDistance(poi.distance)}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.controls}>
          <Pressable
            style={[styles.control, settings.muted && styles.controlActive]}
            onPress={toggleMute}
          >
            <Text style={styles.controlIcon}>{settings.muted ? '🔇' : '🔊'}</Text>
            <Text style={styles.controlLabel}>{settings.muted ? 'Muted' : 'Sound'}</Text>
          </Pressable>

          <Pressable
            style={[styles.control, settings.autoNarrate && styles.controlActive]}
            onPress={toggleAuto}
          >
            <Text style={styles.controlIcon}>🎙️</Text>
            <Text style={styles.controlLabel}>
              {settings.autoNarrate ? 'Auto on' : 'Auto off'}
            </Text>
          </Pressable>

          <Pressable style={[styles.control, styles.controlPrimary]} onPress={tellMeNearest}>
            <Text style={styles.controlIcon}>🗣️</Text>
            <Text style={styles.controlLabel}>Tell me</Text>
          </Pressable>

          <Pressable style={styles.control} onPress={repeatLast}>
            <Text style={styles.controlIcon}>🔁</Text>
            <Text style={styles.controlLabel}>Repeat</Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={showIntro} transparent animationType="fade" onRequestClose={dismissIntro}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Virtual Tour Guide</Text>
            <Text style={styles.modalBody}>
              A hands-free tour guide for the road. As you drive, the app finds nearby
              landmarks — dams, bridges, monuments, parks and more — and reads out
              interesting facts about them.
            </Text>
            <Text style={styles.modalBullet}>• Live map with your position and route</Text>
            <Text style={styles.modalBullet}>• Automatic voice narration as you pass places</Text>
            <Text style={styles.modalBullet}>• Tap any pin or nearby place to hear about it</Text>
            <Text style={styles.modalBullet}>• Free OpenStreetMap and Wikipedia data</Text>
            <Text style={styles.modalBullet}>
              • Keeps the tour running with the screen locked or the app in the
              background
            </Text>
            <Text style={styles.modalBody}>
              Background tracking needs a development or store build with
              “Always” location access. In Expo Go the tour only runs while the
              screen is on, and narration can pause when another app takes over
              the speaker, such as during a phone call.
            </Text>
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>
                Do not interact with the screen while driving. Set it up before you
                leave, and keep your eyes on the road.
              </Text>
            </View>
            <Pressable style={styles.modalButton} onPress={dismissIntro}>
              <Text style={styles.modalButtonText}>Start the tour</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1220' },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    gap: 8,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  pill: {
    backgroundColor: 'rgba(15,23,42,0.85)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.25)',
  },
  pillActive: { borderColor: '#38bdf8', backgroundColor: '#0b1220' },
  pillText: { color: '#e2e8f0', fontSize: 12, fontWeight: '600' },
  notice: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(56,189,248,0.15)',
    borderColor: 'rgba(56,189,248,0.5)',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  noticeText: { color: '#bae6fd', fontSize: 13 },
  errorBanner: {
    backgroundColor: 'rgba(239,68,68,0.18)',
    borderColor: 'rgba(239,68,68,0.5)',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: { color: '#fecaca', fontSize: 13 },
  bannerButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(239,68,68,0.35)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  bannerButtonText: { color: '#fee2e2', fontSize: 13, fontWeight: '700' },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: Platform.OS === 'ios' ? 28 : 18,
    gap: 10,
  },
  card: {
    marginHorizontal: 12,
    backgroundColor: 'rgba(15,23,42,0.92)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.35)',
    padding: 14,
  },
  cardKind: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  cardTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '700' },
  cardText: { color: '#cbd5e1', fontSize: 14, lineHeight: 20, marginTop: 4 },
  hintCard: {
    marginHorizontal: 12,
    backgroundColor: 'rgba(15,23,42,0.9)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.2)',
    padding: 14,
  },
  hintText: { color: '#cbd5e1', fontSize: 14, lineHeight: 20 },
  chipsRow: { flexGrow: 0, height: 62 },
  chips: { paddingHorizontal: 12, gap: 8, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(15,23,42,0.92)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.25)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    maxWidth: 230,
  },
  chipIcon: { fontSize: 18 },
  chipBody: { flexShrink: 1 },
  chipName: { color: '#f1f5f9', fontSize: 13, fontWeight: '600' },
  chipMeta: { color: '#94a3b8', fontSize: 11, marginTop: 1 },
  controls: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
  },
  control: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.92)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.25)',
    paddingVertical: 12,
    alignItems: 'center',
    gap: 3,
  },
  controlActive: {
    borderColor: '#38bdf8',
    backgroundColor: '#11243a',
  },
  controlPrimary: {
    borderColor: '#f59e0b',
    backgroundColor: '#33220a',
  },
  controlIcon: { fontSize: 20 },
  controlLabel: { color: '#f1f5f9', fontSize: 12, fontWeight: '600' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.85)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#0f172a',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.25)',
    padding: 20,
    gap: 6,
  },
  modalTitle: { color: '#f8fafc', fontSize: 22, fontWeight: '800' },
  modalBody: { color: '#cbd5e1', fontSize: 14, lineHeight: 20, marginTop: 4 },
  modalBullet: { color: '#cbd5e1', fontSize: 14, lineHeight: 22 },
  warningBox: {
    marginTop: 8,
    backgroundColor: 'rgba(245,158,11,0.14)',
    borderColor: 'rgba(245,158,11,0.45)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  warningText: { color: '#fde68a', fontSize: 13, lineHeight: 19 },
  modalButton: {
    marginTop: 10,
    backgroundColor: '#38bdf8',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalButtonText: { color: '#082f49', fontSize: 16, fontWeight: '800' },
});
