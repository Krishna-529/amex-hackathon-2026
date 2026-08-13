import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { C, tone, mono } from '../theme';
import { BAND_SAY } from '../lib/forecast';
import { agoLabel, hhmm, mins, durLabel, dayLabel } from '../lib/time';
import { OUTCOME } from '../lib/outcome';
import { useWorld } from '../world';
import { usePoll } from '../lib/usePoll';
import { API_BASE_URL } from '../config';
import type { PreAuthResponse, RecoveryView } from '../api';
import { Glass, Page, PageHead, Pill, RouteLine, Sect } from '../ui';

export default function FlightsScreen({ navigation }: any) {
  const { passengerId, schedule } = useWorld();
  const [allHistory, setAllHistory] = useState(false);

  const upcoming = schedule?.upcoming ?? [];
  const past = schedule?.past ?? [];
  const next = upcoming[0];
  const nextDisrupted = !!next && next.disruptionPhase !== 'none';

  // No passenger id in the URL any more — the session on the request scopes
  // both of these, the same way it does on the web app.
  const nextRecovery = usePoll<RecoveryView>(
    nextDisrupted && passengerId ? `${API_BASE_URL}/api/disruptions/${next!.id}` : null,
    2000,
  );
  const preAuth = usePoll<PreAuthResponse>(
    next && !nextDisrupted && passengerId ? `${API_BASE_URL}/api/flights/${next.id}/preauth` : null,
    6000,
  );

  if (!schedule || !next) {
    return (
      <Page>
        <PageHead title="Your flights" />
      </Page>
    );
  }

  const consent = schedule.passenger.consent;
  const rows = allHistory ? past : past.slice(0, 4);

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

      {!nextDisrupted && next.forecast && next.forecast.pct >= next.forecast.thresholds.preAuthorise && (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => navigation.navigate('FlightDetail', { id: next.id })}
          style={s.alert}
        >
          <View style={s.alertIc}>
            <Text style={{ color: C.risk, fontSize: 17 }}>!</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.alertT}>
              {preAuth
                ? `You've told us what to do if ${next.code} cancels`
                : `${next.code} looks like it will cancel — ${next.forecast?.pct ?? 0}%`}
            </Text>
            <Text style={s.alertB}>
              {preAuth
                ? 'We act the second it happens. No decision window needed at all.'
                : "It hasn't been cancelled. Tell us now what you'd want, while you have time to think."}
            </Text>
          </View>
          <Text style={s.alertGo}>{preAuth ? 'Review →' : 'Decide →'}</Text>
        </TouchableOpacity>
      )}

      {nextDisrupted && (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Recovery', { id: next.id })}
          style={[s.alert, nextRecovery?.phase === 'booked' && s.alertOk]}
        >
          <View style={[s.alertIc, nextRecovery?.phase === 'booked' && s.alertIcOk]}>
            <Text style={{ color: nextRecovery?.phase === 'booked' ? C.safe : C.risk, fontSize: 17 }}>
              {nextRecovery?.phase === 'booked' ? '✓' : '!'}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.alertT}>
              {nextRecovery?.phase === 'booked'
                ? 'Rebooked. Your trip is back together.'
                : nextRecovery?.phase === 'handed'
                  ? 'A person has taken over your trip'
                  : `${next.code} has been cancelled`}
            </Text>
            <Text style={s.alertB}>
              {nextRecovery?.phase === 'booked'
                ? 'Alternative booked · hotel moved · you paid nothing'
                : nextRecovery?.phase === 'handed'
                  ? 'Nothing was booked and nothing was charged.'
                  : `Detected ${agoLabel(new Date(nextRecovery?.detectedAt ?? Date.now()), new Date())}. ${
                      consent === 'autopilot'
                        ? "We're rebooking you now — tap to watch."
                        : 'We need your go-ahead before we book anything.'
                    }`}
            </Text>
          </View>
          <Text style={[s.alertGo, nextRecovery?.phase === 'booked' && { color: C.safe }]}>
            {!nextRecovery?.resolution ? 'Open →' : 'View →'}
          </Text>
        </TouchableOpacity>
      )}

      <Sect>Upcoming</Sect>
      <Glass>
        {upcoming.map((f, i) => {
          const cancelled = f.disruptionPhase !== 'none';
          const dep = new Date(f.depISO);
          const arr = mins(dep, f.durationMin);
          return (
            <TouchableOpacity
              key={f.id}
              activeOpacity={0.7}
              onPress={() => navigation.navigate(cancelled ? 'Recovery' : 'FlightDetail', { id: f.id })}
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
                  <Text style={s.when}>{dayLabel(dep, new Date())}</Text>
                </View>
                <RouteLine from={f.from} to={f.to} dep={hhmm(dep)} arr={hhmm(arr)} dur={durLabel(f.durationMin)} />
                <Text style={s.say}>
                  {cancelled
                    ? 'Cancelled — tap to see the recovery.'
                    : f.forecast
                      ? BAND_SAY[f.forecast.band]
                      : 'Checking this flight against the disruption forecast.'}
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
                    <Text style={[s.predN, { color: tone(f.forecast?.tone ?? 'low') }]}>
                      {f.forecast ? `${f.forecast.pct}%` : '—'}
                    </Text>
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
