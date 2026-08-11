/**
 * The web app's glass primitives, ported. No backdrop-filter on React Native,
 * so "glass" is a translucent fill plus a hairline border — the deep navy
 * ground does the rest of the work.
 */
import React from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, mono, tone } from './theme';
import type { Band } from './lib/risk';

/* ── the one calm field of light at the top of every page ──────────── */
export function Mesh() {
  return (
    <LinearGradient
      colors={['rgba(28,63,122,0.55)', 'rgba(22,50,79,0.18)', 'rgba(8,12,20,0)']}
      style={s.mesh}
      pointerEvents="none"
    />
  );
}

/* ── the app bar ───────────────────────────────────────────────────── */
export function TopBar({
  onBack,
  onProfile,
}: {
  onBack?: () => void;
  onProfile?: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.bar, { paddingTop: insets.top + 10 }]}>
      {onBack ? (
        <TouchableOpacity onPress={onBack} style={s.backBtn} accessibilityLabel="Back">
          <Text style={s.backTxt}>←</Text>
        </TouchableOpacity>
      ) : (
        <Image source={require('../assets/logo.png')} style={s.logo} accessibilityLabel="ZKD Concierge" />
      )}
      <Text style={s.brand}>ZKD Concierge</Text>
      <View style={{ flex: 1 }} />
      <TouchableOpacity style={s.who} onPress={onProfile} accessibilityLabel="Your details">
        <Text style={s.whoTxt}>PS</Text>
      </TouchableOpacity>
    </View>
  );
}

/** Scroll body with the shared page padding. */
export function Page({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={s.page}
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 56 }}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

export function PageHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <View style={s.head}>
      <Text style={s.h1}>{title}</Text>
      {children ? <Text style={s.lede}>{children}</Text> : null}
    </View>
  );
}

/** The `.sect` rule — a mono eyebrow with a fading hairline. */
export function Sect({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.sect}>
      <Text style={s.sectTxt}>{children}</Text>
      <View style={s.sectLine} />
    </View>
  );
}

export function Glass({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[s.glass, style]}>{children}</View>;
}

/** The mono all-caps panel heading. */
export function Eyebrow({ children, color }: { children: React.ReactNode; color?: string }) {
  return <Text style={[s.eyebrow, color ? { color } : null]}>{children}</Text>;
}

export function KV({
  k,
  v,
  ok,
  warn,
  bad,
  first,
  total,
}: {
  k: string;
  v: string;
  ok?: boolean;
  warn?: boolean;
  bad?: boolean;
  first?: boolean;
  total?: boolean;
}) {
  return (
    <View style={[s.kv, first && s.kvFirst, total && s.kvTotal]}>
      <Text style={[s.kvK, total && s.kvKTotal]}>{k}</Text>
      <Text
        style={[
          s.kvV,
          ok && { color: C.safe },
          warn && { color: C.warn },
          bad && { color: C.risk },
          total && s.kvVTotal,
        ]}
      >
        {v}
      </Text>
    </View>
  );
}

export function Why({ children }: { children: React.ReactNode }) {
  return <Text style={s.why}>{children}</Text>;
}

export function Pill({ band, children }: { band: Band | 'done'; children: React.ReactNode }) {
  const col = band === 'done' ? C.mist2 : tone(band);
  return (
    <View
      style={[
        s.pill,
        { borderColor: band === 'done' ? C.edge : col + '46', backgroundColor: col + '1a' },
      ]}
    >
      <View style={[s.pillDot, { backgroundColor: col }]} />
      <Text style={[s.pillTxt, { color: col }]}>{children}</Text>
    </View>
  );
}

/** MAA ──── DEL, with the times underneath. */
export function RouteLine({
  from,
  to,
  dep,
  arr,
  dur,
}: {
  from: string;
  to: string;
  dep: string;
  arr: string;
  dur: string;
}) {
  return (
    <View style={s.route}>
      <View style={s.port}>
        <Text style={s.ap}>{from}</Text>
        <Text style={s.tm}>{dep}</Text>
      </View>
      <View style={s.mid}>
        <Text style={s.dur}>{dur}</Text>
        <View style={s.line}>
          <View style={s.dot} />
        </View>
      </View>
      <View style={[s.port, { alignItems: 'flex-end' }]}>
        <Text style={s.ap}>{to}</Text>
        <Text style={s.tm}>{arr}</Text>
      </View>
    </View>
  );
}

export function Cta({
  label,
  onPress,
  ghost,
}: {
  label: string;
  onPress: () => void;
  ghost?: boolean;
}) {
  return (
    <TouchableOpacity style={[s.cta, ghost && s.ctaGhost]} onPress={onPress} activeOpacity={0.85}>
      <Text style={[s.ctaTxt, ghost && s.ctaTxtGhost]}>{label}</Text>
    </TouchableOpacity>
  );
}

export const s = StyleSheet.create({
  mesh: { position: 'absolute', top: 0, left: 0, right: 0, height: 420 },
  page: { flex: 1 },

  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.edge,
  },
  logo: {
    width: 28,
    height: 28,
    borderRadius: 9,
  },
  backBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: C.edge,
    backgroundColor: C.glass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backTxt: { color: C.text, fontSize: 15, lineHeight: 18 },
  brand: { color: C.text, fontSize: 15.5, fontWeight: '600', letterSpacing: -0.2 },
  who: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(47,127,240,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  whoTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },

  head: { paddingTop: 18, paddingBottom: 18 },
  h1: { color: C.text, fontSize: 27, fontWeight: '600', letterSpacing: -0.7, lineHeight: 32 },
  lede: { color: C.mist, fontSize: 13.5, lineHeight: 21, marginTop: 8 },

  sect: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 26, marginBottom: 12 },
  sectTxt: {
    fontFamily: mono,
    fontSize: 9.5,
    letterSpacing: 2,
    color: C.mist2,
    textTransform: 'uppercase',
  },
  sectLine: { flex: 1, height: 1, backgroundColor: C.edge },

  glass: {
    backgroundColor: C.glass,
    borderWidth: 1,
    borderColor: C.edge,
    borderRadius: 18,
  },

  eyebrow: {
    fontFamily: mono,
    fontSize: 9.5,
    letterSpacing: 1.9,
    color: C.mist2,
    textTransform: 'uppercase',
    marginBottom: 14,
  },

  kv: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.075)',
  },
  kvFirst: { borderTopWidth: 0, paddingTop: 0 },
  kvK: { color: C.mist, fontSize: 12.5, flex: 1, lineHeight: 18 },
  kvV: {
    fontFamily: mono,
    fontSize: 11.5,
    color: C.text,
    textAlign: 'right',
    flexShrink: 1,
    maxWidth: '58%',
    lineHeight: 18,
  },
  kvTotal: { marginTop: 5, paddingTop: 13, borderTopWidth: 1, borderTopColor: C.edge2 },
  kvKTotal: { color: C.text, fontWeight: '600' },
  kvVTotal: { fontSize: 13.5, fontWeight: '700' },

  why: {
    color: C.mist2,
    fontSize: 11.5,
    lineHeight: 18,
    marginTop: 13,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.075)',
  },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 99,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  pillDot: { width: 5, height: 5, borderRadius: 3 },
  pillTxt: { fontFamily: mono, fontSize: 10, letterSpacing: 0.3 },

  route: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  port: { minWidth: 52 },
  ap: { fontFamily: mono, fontSize: 19, fontWeight: '700', color: C.text },
  tm: { fontSize: 11.5, color: C.mist2, marginTop: 4 },
  mid: { flex: 1, alignItems: 'center' },
  dur: { fontFamily: mono, fontSize: 9.5, color: C.mist2, letterSpacing: 0.8, marginBottom: 6 },
  line: { height: 1, alignSelf: 'stretch', backgroundColor: C.edge2 },
  dot: {
    position: 'absolute',
    right: '14%',
    top: -2,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: C.iris,
  },

  cta: {
    backgroundColor: C.iris,
    borderRadius: 13,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 14,
    borderWidth: 1,
    borderColor: C.iris,
  },
  ctaGhost: { backgroundColor: 'transparent', borderColor: C.edge },
  ctaTxt: { color: '#fff', fontSize: 14, fontWeight: '700' },
  ctaTxtGhost: { color: C.mist },
});
