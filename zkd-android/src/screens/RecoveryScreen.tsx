import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { C, mono } from '../theme';
import { WARM_STEPS, WARM_TOTAL, DECIDE_TOTAL, ACT_TOTAL, MACHINE_TOTAL, QUIET_WINDOW_SECONDS } from '../lib/recovery';
import { secs, money, agoLabel, hhmm } from '../lib/time';
import { useWorld } from '../world';
import { usePoll } from '../lib/usePoll';
import { API_BASE_URL } from '../config';
import { notifyBooked, notifyHandedOver } from '../notify';
import { Cta, Eyebrow, Glass, KV, Page, PageHead } from '../ui';
import { resolveTask, type FlightDetail, type PreAuthResponse, type RecoveryView, type Step } from '../api';

/**
 * A pure renderer of whatever server/engine/simulation.ts says. No local
 * phase machine, no local step timers — `view.shown`/`view.phase`/
 * `view.secondsLeft` are all computed server-side and just displayed here,
 * the same as the web recovery page.
 */
export default function RecoveryScreen({ route, navigation }: any) {
  const { id } = route.params as { id: string };
  const { passengerId, schedule } = useWorld();
  const told = useRef(false);

  const view = usePoll<RecoveryView>(`${API_BASE_URL}/api/disruptions/${id}?passengerId=${passengerId}`, 1500);
  const detail = usePoll<FlightDetail>(`${API_BASE_URL}/api/flights/${id}`, 5000);
  const preAuth = usePoll<PreAuthResponse>(`${API_BASE_URL}/api/flights/${id}/preauth?passengerId=${passengerId}`, 10000);

  const f = schedule?.upcoming.find((x) => x.id === id);
  const booking = f?.booking;

  const act = (action: Parameters<typeof resolveTask>[2]) => {
    resolveTask(id, passengerId, action);
  };

  useEffect(() => {
    if (!view || told.current) return;
    if (view.phase === 'booked' && detail) {
      const alt = detail.candidates.alts.find((a) => a.id === view.chosenAltId);
      if (alt) {
        told.current = true;
        notifyBooked(id, alt.code, alt.dep, view.owedNow ? `${money(view.owedNow)} to you` : 'you paid nothing').catch(() => {});
      }
    } else if (view.phase === 'handed') {
      told.current = true;
      notifyHandedOver(id).catch(() => {});
    }
  }, [view, detail, id]);

  if (!schedule || !view || !detail || !f || !booking) {
    return (
      <Page>
        <PageHead title="Recovering your trip" />
      </Page>
    );
  }

  const alt = detail.candidates.alts.find((a) => a.id === view.chosenAltId);
  const hotel = detail.candidates.hotels.find((h) => h.id === view.chosenHotelId) ?? detail.candidates.hotels[0];
  const cab = detail.candidates.cabs.find((c) => c.id === view.chosenCabId) ?? detail.candidates.cabs[0];
  const hotelCost = hotel ? hotel.extra || hotel.rate : 0;
  const bookable = detail.candidates.alts.filter((a) => a.ok && !view.rejectedAltIds.includes(a.id));
  const elapsed = view.shown.reduce((a, st) => a + st.d, 0);
  const consent = schedule.passenger.consent;
  const gateOpen = view.phase === 'waiting' || view.phase === 'choosing';

  const waitingNote =
    consent === 'autopilot'
      ? ' If you say nothing, we book all of it.'
      : view.owedNow === 0
        ? " You asked to be consulted first — but this costs you nothing, so if you don't answer we'll book it rather than leave you stranded."
        : ` You asked to be consulted first, and this would cost you ${money(view.owedNow)} — so if you don't answer, we stop.`;

  return (
    <Page>
      <PageHead title={`${f.code} was cancelled`}>
        {f.from} → {f.to}, was due to depart {hhmm(new Date(f.depISO))} today. Detected{' '}
        {agoLabel(new Date(view.detectedAt), new Date())}.
      </PageHead>

      {view.note && view.phase !== 'handed' && (
        <Glass style={s.noteCard}>
          <Eyebrow color={C.iris}>Why this happened</Eyebrow>
          <Text style={s.noteTxt}>{view.note}</Text>
        </Glass>
      )}

      {/* everything that happened before the cancellation */}
      <Glass style={s.flow}>
        <View style={s.flowH}>
          <Eyebrow>Before it was cancelled</Eyebrow>
          <Text style={s.timer}>{secs(WARM_TOTAL)} · already done</Text>
        </View>
        <Text style={s.phaseNote}>
          Your flight was flagged at risk hours ago, so this ran then — off the critical path, with
          nothing booked and nothing spent. It is the only reason the part below takes seconds.
        </Text>
        <View style={s.tl}>
          {WARM_STEPS.map((st, i) => (
            <Ev key={st.n} name={st.n} d={st.d} body={st.s} state="warm" last={i === WARM_STEPS.length - 1} />
          ))}
        </View>
      </Glass>

      {/* the live half */}
      <Glass style={s.flow}>
        <View style={s.flowH}>
          <Eyebrow>The moment it was cancelled</Eyebrow>
          <Text style={s.timer}>
            {secs(elapsed)}
            {view.phase === 'booked' ? ` of ${secs(MACHINE_TOTAL)}` : ''}
          </Text>
        </View>
        <Text style={s.phaseNote}>
          {preAuth
            ? 'You authorised this beforehand, so there was no waiting on a human at all — this is the entire recovery.'
            : 'Machine time only. The 90 seconds you get to object is yours, and is not counted here.'}
        </Text>

        <View style={s.tl}>
          {view.phase === 'deciding' && (
            <Ev name="Working it out" d={0} body="Confirming the cancellation and locking in your alternative — a few seconds." state="busy" />
          )}

          {view.shown.map((st: Step, i: number) => (
            <Ev
              key={`${st.n}-${i}`}
              name={st.n}
              d={st.d}
              body={st.s}
              state={i === view.shown.length - 1 && view.phase === 'acting' ? 'busy' : 'done'}
              last={i === view.shown.length - 1 && !gateOpen && view.phase !== 'handed'}
            />
          ))}
        </View>

        {/* ── the consent gate ───────────────────────────────────────── */}
        {gateOpen && (
          <View style={[s.gate, view.phase === 'choosing' && s.gatePaused]}>
            <View style={s.gateH}>
              <Text style={[s.gateLbl, view.phase === 'choosing' && { color: C.warn }]}>
                {view.phase === 'choosing'
                  ? 'Held while you decide'
                  : consent === 'autopilot'
                    ? 'Booking unless you stop us'
                    : 'Waiting for you'}
              </Text>
              <Text style={[s.cd, view.phase === 'choosing' && { color: C.warn }]}>{view.secondsLeft}s</Text>
            </View>
            <View style={s.bar}>
              <View
                style={[
                  s.barFill,
                  {
                    width: `${(view.secondsLeft / QUIET_WINDOW_SECONDS) * 100}%`,
                    backgroundColor: view.phase === 'choosing' ? C.warn : C.iris,
                  },
                ]}
              />
            </View>

            {view.phase === 'waiting' && alt && hotel && cab ? (
              <>
                <Text style={s.gateP}>
                  Here is the whole plan — the flight, the room and both cab legs.{waitingNote}
                </Text>

                <Grp label="Flight">
                  <Line
                    ic="✈"
                    t1={`${alt.code} · ${alt.dep}`}
                    t2={`arrives ${alt.arr} · ${alt.cabin} · seat ${booking.seat}`}
                    r={alt.fare ? money(alt.fare) : 'no cost'}
                    free={!alt.fare}
                  />
                </Grp>

                <Grp label="Room tonight">
                  <Line
                    ic="BED"
                    t1={hotel.name}
                    t2={`${hotel.area} · check-in ${hotel.checkin} · ${hotel.walk}`}
                    r={hotelCost ? money(hotelCost) : 'airline pays'}
                    free={!hotelCost}
                  />
                </Grp>

                <Grp label={`Cab · ${cab.kind}`}>
                  {detail.candidates.cabLegs.map((l) => (
                    <Line
                      key={l.id}
                      ic="CAB"
                      t1={`${l.from} → ${l.to}`}
                      t2={`${cab.kind} · pickup ${l.pickup} · ${l.note}`}
                      r={cab.extra ? money(cab.extra / 2) : 'airline pays'}
                      free={!cab.extra}
                    />
                  ))}
                </Grp>

                <View style={s.acts}>
                  <TouchableOpacity style={[s.btn, s.btnGo]} onPress={() => act({ kind: 'approve' })} activeOpacity={0.85}>
                    <Text style={s.btnGoTxt}>Yes, book it now</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.btn} onPress={() => act({ kind: 'browse' })} activeOpacity={0.7}>
                    <Text style={s.btnTxt}>Show me other options</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.btn} onPress={() => act({ kind: 'hand-over' })} activeOpacity={0.7}>
                    <Text style={s.btnTxt}>I&apos;ll take it from here</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : view.phase === 'choosing' ? (
              <>
                <Text style={s.gateP}>
                  {bookable.length} of {detail.candidates.alts.length} work for you. The rest are blocked by
                  your own policy — we&apos;ll tell you which rule, not just &ldquo;unavailable&rdquo;.
                </Text>

                <Text style={s.grpLbl}>Flights</Text>
                {detail.candidates.alts.map((a) => {
                  const excluded = view.rejectedAltIds.includes(a.id);
                  const usable = a.ok && !excluded;
                  return (
                    <Opt
                      key={a.id}
                      usable={usable}
                      picked={a.id === view.chosenAltId}
                      onPress={() => act({ kind: 'choose', altId: a.id })}
                      fl={`${a.code} · ${a.dep}`}
                      mt={
                        excluded
                          ? 'You rejected this — it can never be re-proposed'
                          : a.ok
                            ? `arrives ${a.arr} · ${a.cabin} · ${a.seats} seats left`
                            : a.why
                      }
                      pr={excluded ? 'excluded' : a.ok ? (a.fare ? money(a.fare) : 'no cost to you') : 'not bookable'}
                      free={usable && !a.fare}
                    />
                  );
                })}

                <Text style={[s.grpLbl, { marginTop: 18 }]}>Room tonight</Text>
                {detail.candidates.hotels.map((h) => (
                  <Opt
                    key={h.id}
                    usable={h.ok}
                    picked={h.id === view.chosenHotelId}
                    onPress={() => act({ kind: 'swap-hotel', hotelId: h.id })}
                    fl={h.name}
                    mt={h.ok ? `${h.area} · check-in ${h.checkin}` : h.why}
                    pr={h.ok ? (h.extra ? `${money(h.extra)} over` : 'airline pays') : 'over the cap'}
                    free={h.ok && !h.extra}
                  />
                ))}

                <Text style={[s.grpLbl, { marginTop: 18 }]}>Cab for both legs</Text>
                {detail.candidates.cabs.map((c) => (
                  <Opt
                    key={c.id}
                    usable={c.ok}
                    picked={c.id === view.chosenCabId}
                    onPress={() => act({ kind: 'swap-cab', cabId: c.id })}
                    fl={c.kind}
                    mt={c.ok ? `up to ${c.seats} seats · ${c.why}` : c.why}
                    pr={c.ok ? (c.extra ? `${money(c.extra)} over` : 'airline pays') : 'over the cap'}
                    free={c.ok && !c.extra}
                  />
                ))}

                <View style={[s.acts, { marginTop: 16 }]}>
                  <TouchableOpacity style={[s.btn, s.btnGo]} onPress={() => act({ kind: 'approve' })} activeOpacity={0.85}>
                    <Text style={s.btnGoTxt}>Book this plan</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.btn} onPress={() => act({ kind: 'back' })} activeOpacity={0.7}>
                    <Text style={s.btnTxt}>Back to the plan</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </View>
        )}

        {view.phase === 'handed' && (
          <View style={[s.gate, s.gateStopped]}>
            <View style={s.gateH}>
              <Text style={[s.gateLbl, { color: C.risk }]}>Stopped</Text>
            </View>
            <Text style={s.gateP}>{view.note}</Text>
            <Cta label="Back to my flights" ghost onPress={() => navigation.navigate('Flights')} />
          </View>
        )}
      </Glass>

      {/* ── once it is booked, nothing above is changeable any more ──── */}
      {view.phase === 'booked' && alt && hotel && cab && (
        <>
          <Glass style={s.done}>
            <Eyebrow color={C.safe}>Your trip now</Eyebrow>
            <Diff k1="Flight" v1={`${f.code} · ${hhmm(new Date(f.depISO))}`} k2="Rebooked" v2={`${alt.code} · ${alt.dep}`} first />
            <Diff
              k1="Hotel"
              v1={`${detail.candidates.hotels[0].name}, 14:00`}
              k2={hotel.id === detail.candidates.hotels[0].id ? 'Re-timed' : 'Changed'}
              v2={`${hotel.name}, ${hotel.checkin}`}
            />
            <Diff
              k1="Cab"
              v1={detail.candidates.cabs[0].kind}
              k2={cab.id === detail.candidates.cabs[0].id ? 'Re-timed' : 'Upgraded'}
              v2={`${cab.kind}, both legs`}
            />
            <Diff k1="Record locator" v1={booking.pnr} k2="Reissued" v2="new reference on file" />
          </Glass>

          <Glass style={{ padding: 18 }}>
            <Eyebrow>What it cost you</Eyebrow>
            <KV first k="Flight fare difference" v={alt.fare ? money(alt.fare) : 'airline pays'} ok={!alt.fare} warn={!!alt.fare} />
            <KV
              k={`Room · ${hotel.name}`}
              v={hotelCost ? `${money(hotelCost)} over the allowance` : 'airline pays'}
              ok={!hotelCost}
              warn={!!hotelCost}
            />
            <KV
              k={`Cab · ${cab.kind}, both legs`}
              v={cab.extra ? `${money(cab.extra)} over the allowance` : 'airline pays'}
              ok={!cab.extra}
              warn={!!cab.extra}
            />
            <KV total k="Charged to your card" v={view.owedNow ? money(view.owedNow) : 'nothing'} ok={!view.owedNow} warn={!!view.owedNow} />
            <KV k="Decision time" v={secs(DECIDE_TOTAL)} />
            <KV k="Execution time" v={secs(ACT_TOTAL)} />
            <KV k="Prepared in advance" v={`${secs(WARM_TOTAL)}, before it happened`} />
            <Cta label="Back to my flights" ghost onPress={() => navigation.navigate('Flights')} />
          </Glass>
        </>
      )}
    </Page>
  );
}

/* ── timeline event ─────────────────────────────────────────────────── */
function Ev({
  name, d, body, state, last,
}: { name: string; d: number; body: string; state: 'warm' | 'done' | 'busy'; last?: boolean }) {
  const col = state === 'busy' ? C.warn : state === 'warm' ? C.mist2 : C.iris;
  return (
    <View style={[s.ev, last && { paddingBottom: 0 }]}>
      <View style={[s.rail, { backgroundColor: state === 'warm' ? 'rgba(228,234,244,.16)' : 'rgba(47,127,240,.28)' }]} />
      <View style={[s.node, { borderColor: col, backgroundColor: state === 'busy' ? '#0b0d18' : col }]}>
        {state !== 'busy' && <Text style={s.tick}>✓</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <View style={s.evH}>
          <Text style={[s.evN, state === 'warm' && { color: C.mist }]}>{name}</Text>
          {d > 0 && <Text style={s.evT}>{secs(d)}</Text>}
        </View>
        <Text style={s.evS}>{body}</Text>
      </View>
    </View>
  );
}

function Grp({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={s.grpLbl}>{label}</Text>
      {children}
    </View>
  );
}

function Line({ ic, t1, t2, r, free }: { ic: string; t1: string; t2: string; r: string; free: boolean }) {
  return (
    <View style={s.line}>
      <Text style={s.lineIc}>{ic}</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.lineT1}>{t1}</Text>
        <Text style={s.lineT2}>{t2}</Text>
      </View>
      <Text style={[s.lineR, free && { color: C.safe }]}>{r}</Text>
    </View>
  );
}

function Opt({
  usable, picked, onPress, fl, mt, pr, free,
}: {
  usable: boolean; picked: boolean; onPress: () => void;
  fl: string; mt: string; pr: string; free: boolean;
}) {
  return (
    <TouchableOpacity
      style={[s.opt, picked && s.optPick, !usable && s.optNo]}
      disabled={!usable}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={{ flex: 1 }}>
        <Text style={s.optFl}>{fl}</Text>
        <Text style={s.optMt}>{mt}</Text>
        {picked && <Text style={s.optRec}>✓ we picked this</Text>}
      </View>
      <Text style={[s.optPr, free && { color: C.safe }, !usable && s.optPrNo]}>{pr}</Text>
    </TouchableOpacity>
  );
}

function Diff({ k1, v1, k2, v2, first }: { k1: string; v1: string; k2: string; v2: string; first?: boolean }) {
  return (
    <View style={[s.diff, first && { borderTopWidth: 0, paddingTop: 0 }]}>
      <View style={{ flex: 1, opacity: 0.45 }}>
        <Text style={s.diffK}>{k1}</Text>
        <Text style={[s.diffV, { textDecorationLine: 'line-through' }]}>{v1}</Text>
      </View>
      <Text style={s.arw}>→</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.diffK}>{k2}</Text>
        <Text style={[s.diffV, { color: C.safe }]}>{v2}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  noteCard: { padding: 16, marginBottom: 14, borderColor: 'rgba(47,127,240,.3)' },
  noteTxt: { color: C.mist, fontSize: 12.5, lineHeight: 20 },

  flow: { padding: 18, marginBottom: 14 },
  flowH: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  timer: {
    fontFamily: mono,
    fontSize: 9.5,
    color: C.mist2,
    letterSpacing: 0.8,
    marginLeft: 'auto',
    textTransform: 'uppercase',
  },
  phaseNote: { marginTop: -6, marginBottom: 16, fontSize: 11.5, color: C.mist2, lineHeight: 17 },

  tl: {},
  ev: { flexDirection: 'row', paddingBottom: 20, position: 'relative' },
  rail: { position: 'absolute', left: 9, top: 18, bottom: 0, width: 2 },
  node: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    marginRight: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: { fontSize: 10, fontWeight: '900', color: '#08101f', lineHeight: 12 },
  evH: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 4 },
  evN: { color: C.text, fontSize: 13.5, fontWeight: '600', flex: 1, lineHeight: 19 },
  evT: { fontFamily: mono, fontSize: 10.5, color: C.mist2 },
  evS: { fontSize: 11.5, color: C.mist2, lineHeight: 17 },

  gate: {
    borderWidth: 1,
    borderColor: 'rgba(47,127,240,.34)',
    backgroundColor: 'rgba(47,127,240,.07)',
    borderRadius: 15,
    padding: 15,
    marginTop: 4,
  },
  gatePaused: { borderColor: 'rgba(211,160,63,.4)', backgroundColor: 'rgba(211,160,63,.07)' },
  gateStopped: { borderColor: 'rgba(217,97,90,.4)', backgroundColor: 'rgba(217,97,90,.07)' },
  gateH: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  gateLbl: {
    fontFamily: mono,
    fontSize: 9.5,
    letterSpacing: 1.5,
    color: C.iris,
    textTransform: 'uppercase',
    flex: 1,
  },
  cd: { fontFamily: mono, fontSize: 20, fontWeight: '700', color: C.iris },
  bar: { height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,.09)', overflow: 'hidden', marginBottom: 13 },
  barFill: { height: 4, borderRadius: 99 },
  gateP: { color: C.mist, fontSize: 12.5, lineHeight: 19, marginBottom: 4 },

  grpLbl: {
    fontFamily: mono,
    fontSize: 9,
    letterSpacing: 1.5,
    color: C.mist2,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 4,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.edge,
    backgroundColor: C.glass,
    marginBottom: 8,
  },
  lineIc: { width: 26, fontFamily: mono, fontSize: 10, color: C.mist2 },
  lineT1: { fontFamily: mono, fontSize: 12.5, fontWeight: '600', color: C.text },
  lineT2: { fontSize: 11, color: C.mist2, marginTop: 3, lineHeight: 16 },
  lineR: { fontFamily: mono, fontSize: 11.5, color: C.text, textAlign: 'right' },

  acts: { marginTop: 14, gap: 8 },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.edge2,
    alignItems: 'center',
  },
  btnTxt: { color: C.text, fontSize: 13, fontWeight: '600' },
  btnGo: { backgroundColor: C.iris, borderColor: C.iris },
  btnGoTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },

  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.edge,
    backgroundColor: C.glass,
    marginBottom: 9,
  },
  optPick: { borderColor: 'rgba(75,171,124,.45)', backgroundColor: 'rgba(75,171,124,.09)' },
  optNo: { opacity: 0.42 },
  optFl: { fontFamily: mono, fontSize: 13, fontWeight: '600', color: C.text },
  optMt: { fontSize: 11, color: C.mist2, marginTop: 4, lineHeight: 16 },
  optRec: { fontFamily: mono, fontSize: 8.5, letterSpacing: 1.2, color: C.safe, marginTop: 5, textTransform: 'uppercase' },
  optPr: { fontFamily: mono, fontSize: 12, color: C.text, textAlign: 'right', maxWidth: 96 },
  optPrNo: { fontSize: 9, letterSpacing: 0.8, color: C.risk, textTransform: 'uppercase' },

  done: {
    padding: 18,
    marginBottom: 14,
    borderColor: 'rgba(75,171,124,.34)',
    backgroundColor: 'rgba(75,171,124,.08)',
  },
  diff: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,.075)',
  },
  diffK: { fontFamily: mono, fontSize: 8.5, letterSpacing: 1.2, color: C.mist2, textTransform: 'uppercase', marginBottom: 4 },
  diffV: { fontFamily: mono, fontSize: 12, color: C.text },
  arw: { color: C.iris, fontSize: 14 },
});
