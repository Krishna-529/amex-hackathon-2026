import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { C, mono, tone } from '../theme';
import { forecastFor, BAND_LABEL, BAND_SAY, BAND_TONE } from '../lib/forecast';
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

  const isPast = !('watched' in f) || !f.watched;
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

  const fc = forecastFor(f.code);
  if (!fc) return <Page>{head}</Page>;
  const t = BAND_TONE[fc.band];

  return (
    <Page>
      {head}

      <Glass style={s.gauge}>
        <Text style={[s.big, { color: tone(t) }]}>{fc.pct}%</Text>
        <Text style={s.cap}>cancel risk</Text>
        <Text style={[s.band, { color: tone(t) }]}>{BAND_LABEL[fc.band]}</Text>
        <Text style={s.say}>{BAND_SAY[fc.band]}</Text>
      </Glass>

      <Glass style={{ padding: 18, marginBottom: 14 }}>
        <Eyebrow>Where this number comes from</Eyebrow>
        <KV first k="Forecast source" v={fc.source === 'lumo' ? 'Lumo — live' : 'Lumo — mocked, no key yet'} />
        <KV k="We ask you in advance at" v={`${fc.askEarlyAt}%`} />
        <Text style={s.note}>
          We buy this forecast rather than building one, and that threshold moves with how many seats
          are left on the route and how close departure is. Until it has been checked against what
          actually happened, it decides when we start preparing — never whether we spend your money.
        </Text>
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
