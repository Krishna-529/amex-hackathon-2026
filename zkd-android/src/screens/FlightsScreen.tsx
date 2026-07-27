import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { C, mono, tone } from '../theme';
import { risk, BAND_SAY } from '../lib/risk';
import { agoLabel } from '../lib/time';
import { OUTCOME, type PastFlight } from '../lib/data';
import { useWorld } from '../world';
import { notifyCancelled } from '../notify';
import { Glass, Page, PageHead, Pill, RouteLine, Sect, s as u } from '../ui';

export default function FlightsScreen({ navigation }: any) {
  const { world, disrupted, setDisrupted, consent, settled, chosen } = useWorld();
  const [allHistory, setAllHistory] = useState(false);
  const fired = useRef(false);
  const drop = useRef(new Animated.Value(0)).current;

  /* the cancellation lands a couple of seconds after you open the app */
  useEffect(() => {
    if (!world || disrupted) return;
    const t = setTimeout(() => setDisrupted(true), 3000);
    return () => clearTimeout(t);
  }, [world, disrupted, setDisrupted]);

  /* …and it arrives as a real notification, not just an in-app banner */
  useEffect(() => {
    if (!world || !disrupted || fired.current) return;
    fired.current = true;
    notifyCancelled(world.upcoming[0].code, world.upcoming[0].dep, consent === 'autopilot').catch(
      () => {},
    );
    Animated.timing(drop, { toValue: 1, duration: 520, useNativeDriver: true }).start();
  }, [world, disrupted, consent, drop]);

  if (!world) {
    return (
      <Page>
        <PageHead title="Your flights" />
      </Page>
    );
  }

  const { upcoming, past, alts, detected } = world;
  const pick = alts.find((a) => a.id === chosen)!;
  const rows: PastFlight[] = allHistory ? past : past.slice(0, 4);

  return (
    <Page>
      <PageHead title="Your flights">
        We watch every booking and act the moment something breaks —{' '}
        {consent === 'autopilot' ? 'without waking you' : 'then wait for your go-ahead'}.{' '}
        <Text style={{ color: C.iris }} onPress={() => navigation.navigate('Profile')}>
          {consent === 'autopilot' ? 'Autopilot' : 'Ask me first'}
        </Text>{' '}
        is the permission you set when you activated your card.
      </PageHead>

      {disrupted && (
        <Animated.View
          style={{
            opacity: drop,
            transform: [{ translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) }],
          }}
        >
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Recovery')}
            style={[s.alert, settled === 'booked' && s.alertOk]}
          >
            <View style={[s.alertIc, settled === 'booked' && s.alertIcOk]}>
              <Text style={{ color: settled === 'booked' ? C.safe : C.risk, fontSize: 17 }}>
                {settled === 'booked' ? '✓' : '!'}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.alertT}>
                {settled === 'booked'
                  ? 'Rebooked. Your trip is back together.'
                  : settled === 'handed-over'
                    ? 'A person has taken over your trip'
                    : `${upcoming[0].code} has been cancelled`}
              </Text>
              <Text style={s.alertB}>
                {settled === 'booked'
                  ? `${pick.code} at ${pick.dep} · hotel moved · you paid nothing`
                  : settled === 'handed-over'
                    ? 'Nothing was booked and nothing was charged.'
                    : `Detected ${agoLabel(detected, world.now)}. ${
                        consent === 'autopilot'
                          ? "We're rebooking you now — tap to watch."
                          : 'We need your go-ahead before we book anything.'
                      }`}
              </Text>
            </View>
            <Text style={[s.alertGo, settled === 'booked' && { color: C.safe }]}>
              {settled === 'none' ? 'Open →' : 'View →'}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      <Sect>Upcoming</Sect>
      <Glass>
        {upcoming.map((f, i) => {
          const cancelled = f.id === 'u1' && disrupted;
          const r = risk(f.signals!);
          return (
            <TouchableOpacity
              key={f.id}
              activeOpacity={0.7}
              onPress={() =>
                cancelled
                  ? navigation.navigate('Recovery')
                  : navigation.navigate('FlightDetail', { id: f.id })
              }
              style={[s.uprow, i > 0 && s.uprowDiv]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={s.meta}>
                  <Text style={s.code}>{f.code}</Text>
                  {i === 0 && !cancelled && (
                    <View style={[s.tag, s.tagNext]}>
                      <Text style={[s.tagTxt, { color: C.iris }]}>Next</Text>
                    </View>
                  )}
                  {cancelled && (
                    <View style={[s.tag, { borderColor: 'rgba(217,97,90,.4)' }]}>
                      <Text style={[s.tagTxt, { color: C.risk }]}>Cancelled</Text>
                    </View>
                  )}
                  <Text style={s.when}>{f.date}</Text>
                </View>
                <RouteLine from={f.from} to={f.to} dep={f.dep} arr={f.arr} dur={f.dur} />
                <Text style={s.say}>
                  {cancelled
                    ? settled === 'booked'
                      ? `We rebooked you on ${pick.code} at ${pick.dep} and moved tonight's hotel — you paid nothing.`
                      : 'We have alternatives ready and are waiting on the go-ahead.'
                    : BAND_SAY[r.band]}
                </Text>
              </View>
              <View style={s.pred}>
                {cancelled ? (
                  <>
                    <Text style={[s.predN, { color: C.risk, fontSize: 34 }]}>✕</Text>
                    <Text style={s.predLb}>cancelled</Text>
                  </>
                ) : (
                  <>
                    <Text style={[s.predN, { color: tone(r.band) }]}>{r.pct}%</Text>
                    <Text style={s.predLb}>cancel risk</Text>
                  </>
                )}
                <Text style={s.predGo}>{cancelled ? 'Recovery →' : 'Details →'}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </Glass>

      <Sect>Recent history</Sect>
      <Glass>
        {rows.map((f, i) => {
          const o = OUTCOME[f.outcome];
          return (
            <TouchableOpacity
              key={f.id}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('FlightDetail', { id: f.id })}
              style={[s.hrow, i > 0 && s.uprowDiv]}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.hcode}>
                  {f.code}
                  <Text style={{ color: C.mist2 }}>{`  ${f.from} → ${f.to}`}</Text>
                </Text>
                <Text style={s.hdate}>
                  {f.date} · {f.exact} · {f.dep}
                </Text>
              </View>
              <Pill band={o.cls === 'done' ? 'done' : (o.cls as any)}>{o.label}</Pill>
            </TouchableOpacity>
          );
        })}
      </Glass>
      <TouchableOpacity onPress={() => setAllHistory((v) => !v)} style={s.more}>
        <Text style={s.moreTxt}>
          {allHistory ? 'Show fewer' : `See all ${past.length} flights →`}
        </Text>
      </TouchableOpacity>

      <Text style={s.foot}>
        ZKD Concierge watches every booking, detects a disruption the moment the airline files it, and
        rebooks your flight, hotel and ground legs inside your policy — then tells you what it did.
      </Text>
    </Page>
  );
}

const s = StyleSheet.create({
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    padding: 15,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(217,97,90,.34)',
    backgroundColor: 'rgba(217,97,90,.08)',
    marginBottom: 6,
  },
  alertOk: { borderColor: 'rgba(75,171,124,.34)', backgroundColor: 'rgba(75,171,124,.08)' },
  alertIc: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(217,97,90,.16)',
    borderWidth: 1,
    borderColor: 'rgba(217,97,90,.3)',
  },
  alertIcOk: { backgroundColor: 'rgba(75,171,124,.14)', borderColor: 'rgba(75,171,124,.3)' },
  alertT: { color: C.text, fontWeight: '700', fontSize: 14 },
  alertB: { color: C.mist, fontSize: 12, marginTop: 3, lineHeight: 17 },
  alertGo: { color: C.risk, fontSize: 12 },

  uprow: { flexDirection: 'row', gap: 14, padding: 16, alignItems: 'center' },
  uprowDiv: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,.075)' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  code: { fontFamily: mono, fontSize: 11.5, color: C.mist, letterSpacing: 0.4 },
  when: { fontSize: 11, color: C.mist2, marginLeft: 'auto' },
  tag: { borderWidth: 1, borderColor: C.edge, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  tagNext: { borderColor: 'rgba(47,127,240,.4)', backgroundColor: 'rgba(47,127,240,.1)' },
  tagTxt: { fontFamily: mono, fontSize: 8.5, letterSpacing: 1, textTransform: 'uppercase' },
  say: { color: C.mist2, fontSize: 11, lineHeight: 16, marginTop: 10 },

  pred: {
    width: 92,
    alignItems: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: C.edge,
    paddingLeft: 12,
  },
  predN: { fontSize: 30, fontWeight: '700', letterSpacing: -1.2 },
  predLb: { fontSize: 10, color: C.mist2, marginTop: 5, textAlign: 'center' },
  predGo: { fontSize: 11, color: C.text, marginTop: 12, opacity: 0.85 },

  hrow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15 },
  hcode: { fontFamily: mono, fontSize: 12.5, color: C.text },
  hdate: { fontSize: 11, color: C.mist2, marginTop: 5 },

  more: { paddingVertical: 14, alignItems: 'center' },
  moreTxt: { color: C.mist, fontSize: 12.5 },

  foot: {
    color: C.mist2,
    fontSize: 11.5,
    lineHeight: 18,
    marginTop: 26,
    paddingTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.edge,
  },
});
