import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { C, mono, tone } from '../theme';
import { BAND_LABEL, BAND_SAY } from '../lib/forecast';
import { OUTCOME } from '../lib/outcome';
import { money, hhmm, mins, durLabel, dayLabel } from '../lib/time';
import { useWorld } from '../world';
import { usePoll } from '../lib/usePoll';
import { API_BASE_URL } from '../config';
import type { FlightDetail, PastFlight } from '../api';
import { Cta, Eyebrow, Glass, KV, Page, PageHead, RouteLine } from '../ui';

function routeRecord(past: PastFlight[], from: string, to: string) {
  const rows = past.filter((p) => p.from === from && p.to === to);
  return { flown: rows.length, cancelled: rows.filter((p) => p.outcome === 'cancelled').length };
}

export default function FlightDetailScreen({ route, navigation }: any) {
  const { id } = route.params as { id: string };
  const { schedule } = useWorld();

  const upcoming = schedule?.upcoming.find((x) => x.id === id);
  const past = schedule?.past.find((x) => x.id === id);
  const detail = usePoll<FlightDetail>(upcoming ? `${API_BASE_URL}/api/flights/${id}` : null, 5000);

  if (!schedule) {
    return (
      <Page>
        <PageHead title="Loading your flight" />
      </Page>
    );
  }

  if (!upcoming && !past) {
    return (
      <Page>
        <PageHead title="Flight not found" />
      </Page>
    );
  }

  const routeOf = upcoming ?? past!;
  const rec = routeRecord(schedule.past, routeOf.from, routeOf.to);

  /* ── a flight that already happened ─────────────────────────────── */
  if (past) {
    const o = OUTCOME[past.outcome];
    const head = (
      <>
        <PageHead title={`${past.code} · ${past.from} → ${past.to}`}>
          {past.date} · {past.dep} – {past.arr}
        </PageHead>
        <Glass style={{ padding: 18, marginBottom: 14 }}>
          <RouteLine from={past.from} to={past.to} dep={past.dep} arr={past.arr} dur={past.dur} />
        </Glass>
      </>
    );
    return (
      <Page>
        {head}
        <Glass style={{ padding: 18, marginBottom: 14 }}>
          <Eyebrow>What happened</Eyebrow>
          <KV
            first
            k="Outcome"
            v={o.label}
            ok={past.outcome === 'ontime'}
            warn={past.outcome === 'delayed'}
            bad={past.outcome === 'cancelled'}
          />
          <KV k="Detail" v={past.detail} />
          <KV k={`You've flown ${past.from}→${past.to}`} v={`${rec.flown}× · ${rec.cancelled} cancelled`} />
        </Glass>
        {past.recovered ? (
          <Glass style={s.plan}>
            <Eyebrow color={C.iris}>What we did</Eyebrow>
            <Text style={s.planP}>{past.recovered}</Text>
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

  const f = upcoming!;
  const dep = new Date(f.depISO);
  const arr = mins(dep, f.durationMin);

  const head = (
    <>
      <PageHead title={`${f.code} · ${f.from} → ${f.to}`}>
        {dayLabel(dep, new Date())}
        {f.aircraft ? ` · ${f.aircraft}` : ''} · {hhmm(dep)} – {hhmm(arr)}
      </PageHead>
      <Glass style={{ padding: 18, marginBottom: 14 }}>
        <RouteLine from={f.from} to={f.to} dep={hhmm(dep)} arr={hhmm(arr)} dur={durLabel(f.durationMin)} />
      </Glass>
    </>
  );

  /* a cancelled upcoming flight belongs on the recovery screen, not here */
  if (f.disruptionPhase !== 'none') {
    return (
      <Page>
        {head}
        <Glass style={{ padding: 18 }}>
          <Eyebrow>This flight was cancelled</Eyebrow>
          <Text style={s.planP}>We&apos;ve already rebuilt your trip around it.</Text>
          <Cta label="View the recovery →" onPress={() => navigation.replace('Recovery', { id: f.id })} />
        </Glass>
      </Page>
    );
  }

  if (!detail) {
    return (
      <Page>
        {head}
        <PageHead title="Loading risk detail…" />
      </Page>
    );
  }

  const fc = detail.forecast;
  const usableAlts = detail.candidates.alts.filter((a) => a.ok);

  return (
    <Page>
      {head}

      <Glass style={s.gauge}>
        <Text style={[s.big, { color: tone(fc?.tone ?? 'low') }]}>{fc ? `${fc.pct}%` : '—'}</Text>
        <Text style={s.cap}>cancel risk</Text>
        {fc ? <Text style={[s.band, { color: tone(fc.tone) }]}>{BAND_LABEL[fc.band]}</Text> : null}
        <Text style={s.say}>
          {fc ? BAND_SAY[fc.band] : 'Checking this flight against the disruption forecast.'}
        </Text>
      </Glass>

      {fc ? (
        <Glass style={{ padding: 18, marginBottom: 14 }}>
          <Eyebrow>Where this number comes from</Eyebrow>
          <KV first k="Forecast source" v={fc.source === 'lumo' ? 'Lumo — live' : 'Lumo — mocked, no key yet'} />
          <KV k="Confidence" v={`${Math.round(fc.confidence * 100)}%`} />
          <KV k="We ask you in advance at" v={`${fc.thresholds.preAuthorise}%`} />
          <KV k="Seats left across every source" v={String(fc.thresholds.inputs.seatsAvailable)} />
          <Text style={s.note}>
            We buy this forecast rather than building one, and that threshold moves with how many
            seats are left and how close departure is. Until it has been checked against what
            actually happened, it decides when we start preparing — never whether we spend your money.
          </Text>
        </Glass>
      ) : null}

      <Glass style={{ padding: 18, marginBottom: 14 }}>
        <Eyebrow>Your booking</Eyebrow>
        <KV first k="Terminal" v={f.terminal ?? '—'} />
        <KV k="Seat" v={f.booking?.seat ?? '—'} />
        <KV k="Reference" v={f.booking?.pnr ?? '—'} />
        <KV k="You've flown this route" v={`${rec.flown}× · ${rec.cancelled} cancelled`} />
      </Glass>

      <Glass style={{ padding: 18 }}>
        <Eyebrow>If this one goes</Eyebrow>
        <Text style={[s.planP, { marginBottom: 12 }]}>
          We&apos;re already holding {usableAlts.length} alternatives that fit your policy and protect
          your onward connection.
        </Text>
        {usableAlts.map((a, i) => (
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
