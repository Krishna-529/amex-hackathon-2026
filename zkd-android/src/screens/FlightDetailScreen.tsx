import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { C, mono, tone } from '../theme';
import { risk, bandOf, BAND_LABEL, BAND_SAY } from '../lib/risk';
import { OUTCOME, routeRecord, type PastFlight } from '../lib/data';
import { money } from '../lib/time';
import { useWorld } from '../world';
import { Cta, Eyebrow, Glass, KV, Page, PageHead, RouteLine } from '../ui';

export default function FlightDetailScreen({ route, navigation }: any) {
  const { id } = route.params as { id: string };
  const { world, disrupted } = useWorld();

  if (!world) {
    return (
      <Page>
        <PageHead title="Loading your flight" />
      </Page>
    );
  }

  const f = world.upcoming.find((x) => x.id === id) ?? world.past.find((x) => x.id === id);
  if (!f) {
    return (
      <Page>
        <PageHead title="Flight not found" />
      </Page>
    );
  }

  const isPast = !('signals' in f) || !f.signals;
  const rec = routeRecord(world.past, f.from, f.to);

  const head = (
    <>
      <PageHead title={`${f.code} · ${f.from} → ${f.to}`}>
        {f.date}
        {f.aircraft ? ` · ${f.aircraft}` : ''} · {f.dep} – {f.arr}
      </PageHead>
      <Glass style={{ padding: 18, marginBottom: 14 }}>
        <RouteLine from={f.from} to={f.to} dep={f.dep} arr={f.arr} dur={f.dur} />
      </Glass>
    </>
  );

  /* ── a flight that already happened ─────────────────────────────── */
  if (isPast) {
    const pf = f as PastFlight;
    const o = OUTCOME[pf.outcome];
    return (
      <Page>
        {head}
        <Glass style={{ padding: 18, marginBottom: 14 }}>
          <Eyebrow>What happened</Eyebrow>
          <KV
            first
            k="Outcome"
            v={o.label}
            ok={pf.outcome === 'ontime'}
            warn={pf.outcome === 'delayed'}
            bad={pf.outcome === 'cancelled'}
          />
          <KV k="Detail" v={pf.detail} />
          <KV
            k={`You've flown ${f.from}→${f.to}`}
            v={`${rec.flown}× · ${rec.cancelled} cancelled`}
          />
        </Glass>
        {pf.recovered ? (
          <Glass style={s.plan}>
            <Eyebrow color={C.iris}>What we did</Eyebrow>
            <Text style={s.planP}>{pf.recovered}</Text>
          </Glass>
        ) : (
          <Glass style={{ padding: 18 }}>
            <Eyebrow>Notes</Eyebrow>
            <Text style={s.planP}>Nothing needed doing on this one.</Text>
          </Glass>
        )}
      </Page>
    );
  }

  /* a cancelled upcoming flight belongs on the recovery screen, not here */
  if (f.id === 'u1' && disrupted) {
    return (
      <Page>
        {head}
        <Glass style={{ padding: 18 }}>
          <Eyebrow>This flight was cancelled</Eyebrow>
          <Text style={s.planP}>We&apos;ve already rebuilt your trip around it.</Text>
          <Cta label="View the recovery →" onPress={() => navigation.replace('Recovery')} />
        </Glass>
      </Page>
    );
  }

  const r = risk(f.signals!);

  return (
    <Page>
      {head}

      <Glass style={s.gauge}>
        <Text style={[s.big, { color: tone(r.band) }]}>{r.pct}%</Text>
        <Text style={s.cap}>cancel risk</Text>
        <Text style={[s.band, { color: tone(r.band) }]}>{BAND_LABEL[r.band]}</Text>
        <Text style={s.say}>{BAND_SAY[r.band]}</Text>
      </Glass>

      <Glass style={{ padding: 18, marginBottom: 14 }}>
        <Eyebrow>What&apos;s driving it</Eyebrow>
        {r.parts.map((p) => (
          <View key={p.id} style={s.fac}>
            <View style={s.fh}>
              <Text style={s.fn}>{p.name}</Text>
              <Text style={s.fv}>+{p.pts}</Text>
            </View>
            <View style={s.track}>
              <View
                style={[
                  s.fill,
                  { width: `${Math.round(p.v * 100)}%`, backgroundColor: tone(bandOf(p.v)) },
                ]}
              />
            </View>
            <Text style={s.note}>{p.note}</Text>
          </View>
        ))}
      </Glass>

      <Glass style={{ padding: 18, marginBottom: 14 }}>
        <Eyebrow>Your booking</Eyebrow>
        <KV first k="Terminal" v={f.terminal!} />
        <KV k="Seat" v={f.seat!} />
        <KV k="Reference" v={f.pnr!} />
        <KV k="You've flown this route" v={`${rec.flown}× · ${rec.cancelled} cancelled`} />
      </Glass>

      <Glass style={{ padding: 18 }}>
        <Eyebrow>If this one goes</Eyebrow>
        <Text style={[s.planP, { marginBottom: 12 }]}>
          We&apos;re already holding {world.alts.filter((a) => a.ok).length} alternatives that fit your
          policy and protect your onward connection.
        </Text>
        {world.alts
          .filter((a) => a.ok)
          .map((a, i) => (
            <KV
              key={a.id}
              first={i === 0}
              k={`${a.code} · ${a.dep}`}
              v={a.fare ? money(a.fare) : 'no cost to you'}
              ok={!a.fare}
            />
          ))}
      </Glass>
    </Page>
  );
}

const s = StyleSheet.create({
  gauge: { alignItems: 'center', paddingVertical: 30, paddingHorizontal: 22, marginBottom: 14 },
  big: { fontSize: 62, fontWeight: '700', letterSpacing: -3, lineHeight: 68 },
  cap: {
    fontFamily: mono,
    fontSize: 9.5,
    letterSpacing: 1.8,
    color: C.mist2,
    textTransform: 'uppercase',
    marginTop: 6,
  },
  band: {
    fontFamily: mono,
    fontSize: 11,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginTop: 20,
  },
  say: { color: C.mist, fontSize: 13, lineHeight: 20, marginTop: 11, textAlign: 'center' },

  fac: { marginBottom: 16 },
  fh: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 8 },
  fn: { color: C.text, fontSize: 12.5, flex: 1, lineHeight: 17 },
  fv: { fontFamily: mono, fontSize: 11, color: C.mist2 },
  track: { height: 6, borderRadius: 99, backgroundColor: 'rgba(255,255,255,.07)', overflow: 'hidden' },
  fill: { height: 6, borderRadius: 99 },
  note: { fontSize: 11, color: C.mist2, marginTop: 7, lineHeight: 16 },

  plan: {
    padding: 18,
    borderColor: 'rgba(47,127,240,.3)',
    backgroundColor: 'rgba(47,127,240,.07)',
  },
  planP: { color: C.mist, fontSize: 12.5, lineHeight: 20 },
});
