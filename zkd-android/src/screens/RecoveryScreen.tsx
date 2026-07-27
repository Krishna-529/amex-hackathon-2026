import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { C, mono } from '../theme';
import {
  WARM_STEPS, DECIDE_STEPS, ACT_STEPS,
  WARM_TOTAL, DECIDE_TOTAL, ACT_TOTAL, MACHINE_TOTAL,
  QUIET_WINDOW_SECONDS, type Step,
} from '../lib/recovery';
import { secs, money, agoLabel } from '../lib/time';
import { useWorld } from '../world';
import { notifyBooked, notifyHandedOver } from '../notify';
import { Cta, Eyebrow, Glass, KV, Page, PageHead } from '../ui';

type Phase = 'deciding' | 'waiting' | 'choosing' | 'acting' | 'booked' | 'handed';

/** playback: 1 second of real budget → this many ms on screen */
const PLAY = 190;
const FLOOR = 260;
/** Real seconds. The 90-second window is the member's time to think, so it is
 *  not compressed — 1.5 minutes is the point, not an inconvenience. */
const TICK = 1000;

export default function RecoveryScreen({ navigation }: any) {
  const { world, consent, chosen, setChosen, rejected, reject, setSettled } = useWorld();

  const [phase, setPhase] = useState<Phase>('deciding');
  const [shown, setShown] = useState<Step[]>([]);
  const [left, setLeft] = useState(QUIET_WINDOW_SECONDS);
  const [note, setNote] = useState<string | null>(null);
  const [hotelId, setHotelId] = useState('h1');
  const [cabId, setCabId] = useState('c1');
  const started = useRef(false);
  const acting = useRef(false);
  const told = useRef(false);
  const timer = useRef<any>(null);

  const pick = world?.alts.find((a) => a.id === chosen);
  const hotel = world?.hotels.find((h) => h.id === hotelId) ?? world?.hotels[0];
  const cab = world?.cabs.find((c) => c.id === cabId) ?? world?.cabs[0];

  /* ── phase 1: the machine decides ─────────────────────────────────── */
  useEffect(() => {
    if (!world || started.current) return;
    started.current = true;
    let i = 0;
    const run = () => {
      if (i >= DECIDE_STEPS.length) {
        setLeft(QUIET_WINDOW_SECONDS);
        setPhase('waiting');
        return;
      }
      const s = DECIDE_STEPS[i];
      setShown((p) => [...p, s]);
      i += 1;
      timer.current = setTimeout(run, Math.max(FLOOR, s.d * PLAY));
    };
    run();
    return () => clearTimeout(timer.current);
  }, [world]);

  /* ── phase 2: the member's 90 seconds, in real seconds ────────────── */
  const owedNow = (pick?.fare ?? 0) + (hotel?.extra ?? 0) + (cab?.extra ?? 0);

  useEffect(() => {
    if (phase !== 'waiting') return;
    const t = setInterval(() => {
      setLeft((n) => {
        if (n > 1) return n - 1;
        clearInterval(t);
        // Silence means different things depending on what you asked for — but
        // consent gates SPENDING, not care. If the recovery costs nothing there
        // is nothing to consent to, and stranding someone because they didn't
        // pick up is the worse outcome.
        if (consent === 'autopilot') {
          setNote("You didn't answer, so we went ahead — that's the permission you gave us.");
          setPhase('acting');
        } else if (owedNow === 0) {
          setNote("You didn't answer. This costs you nothing, so we booked it rather than leave you stranded — there was no spend to ask about.");
          setPhase('acting');
        } else {
          setNote("You didn't answer, and this one would cost you money — so we stopped. Nothing was booked and nothing was charged.");
          setPhase('handed');
        }
        return 0;
      });
    }, TICK);
    return () => clearInterval(t);
  }, [phase, consent, owedNow]);

  /* ── phase 3: the irreversible half ───────────────────────────────── */
  useEffect(() => {
    if (phase !== 'acting' || acting.current) return;
    acting.current = true;
    let i = 0;
    const run = () => {
      if (i >= ACT_STEPS.length) { setPhase('booked'); return; }
      const s = ACT_STEPS[i];
      setShown((p) => [...p, s]);
      i += 1;
      timer.current = setTimeout(run, Math.max(FLOOR, s.d * PLAY));
    };
    run();
    return () => clearTimeout(timer.current);
  }, [phase]);

  /* ── tell the rest of the app, and tell the phone ─────────────────── */
  useEffect(() => {
    if (phase === 'booked') {
      setSettled('booked');
      if (!told.current && pick && hotel && cab) {
        told.current = true;
        const total = pick.fare + hotel.extra + cab.extra;
        notifyBooked(
          pick.code,
          pick.dep,
          total ? `${money(total)} to you` : 'you paid nothing',
        ).catch(() => {});
      }
    }
    if (phase === 'handed') {
      setSettled('handed-over');
      if (!told.current) {
        told.current = true;
        notifyHandedOver().catch(() => {});
      }
    }
  }, [phase]);

  const approve = useCallback(() => {
    setNote('You approved it, so we went straight through.');
    setPhase('acting');
  }, []);

  const handOver = useCallback(() => {
    setNote('You took the wheel. We stopped immediately — nothing confirmed, nothing paid, and your held seats stay held.');
    setPhase('handed');
  }, []);

  /* opening the options is itself an intervention: hold the clock */
  const browse = useCallback(() => {
    setNote('You stepped in, so the clock is held. Nothing proceeds while you are deciding.');
    setPhase('choosing');
  }, []);

  const choose = useCallback((altId: string) => {
    // The one we were about to book is now permanently rejected, and that
    // exclusion is a policy input — not a preference the planner may ignore.
    if (chosen !== altId) reject(chosen);
    setChosen(altId);
    setNote('Swapped. The one we had picked is now permanently excluded — it can never be re-proposed.');
    setPhase('waiting');
  }, [chosen, reject, setChosen]);

  if (!world || !pick || !hotel || !cab) {
    return (
      <Page>
        <PageHead title="Recovering your trip" />
      </Page>
    );
  }

  /* what the member actually ends up paying, from what they actually picked */
  const owed = pick.fare + hotel.extra + cab.extra;

  const body = (s: Step) =>
    s.live === 'seat'
      ? `${pick.code} at ${pick.dep}, seat 14C. The airline cancelled, so the fare difference is theirs — you pay nothing.`
      : s.live === 'van'
        ? `A single-use card locked to ${owed ? money(owed) : '₹0'} and today's date — exactly the plan you were shown, and it cannot be reused or overspent.`
      : s.live === 'hotel'
        ? `${hotel.name}, check-in ${hotel.checkin}. ${hotel.why}.`
      : s.live === 'cab'
        ? `${cab.kind} booked for both legs — ${world.cabLegs[0].from} → ${world.cabLegs[0].to} at ${world.cabLegs[0].pickup}, and back at ${world.cabLegs[1].pickup}.`
      : s.live === 'onward'
        ? `${world.upcoming[1].code} to London at ${world.upcoming[1].dep} re-checked and still valid — a no-show on the first leg can silently void the rest of an itinerary.`
        : s.s;

  const elapsed = shown.reduce((a, s) => a + s.d, 0);
  const bookable = world.alts.filter((a) => a.ok && !rejected.includes(a.id));
  const gateOpen = phase === 'waiting' || phase === 'choosing';

  return (
    <Page>
      <PageHead title={`${world.upcoming[0].code} was cancelled`}>
        MAA → DEL, was due to depart {world.upcoming[0].dep} today. Detected{' '}
        {agoLabel(world.detected, world.now)}.
      </PageHead>

      {note && phase !== 'handed' && (
        <Glass style={s.noteCard}>
          <Eyebrow color={C.iris}>Why this happened</Eyebrow>
          <Text style={s.noteTxt}>{note}</Text>
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
            {phase === 'booked' ? ` of ${secs(MACHINE_TOTAL)}` : ''}
          </Text>
        </View>
        <Text style={s.phaseNote}>
          Machine time only. The 90 seconds you get to object is yours, and is not counted here.
        </Text>

        <View style={s.tl}>
          {shown.map((st, i) => (
            <Ev
              key={`${st.n}-${i}`}
              name={st.n}
              d={st.d}
              body={body(st)}
              state={i === shown.length - 1 && (phase === 'deciding' || phase === 'acting') ? 'busy' : 'done'}
              last={i === shown.length - 1 && !gateOpen && phase !== 'handed'}
            />
          ))}
        </View>

        {/* ── the consent gate ───────────────────────────────────────── */}
        {gateOpen && (
          <View style={[s.gate, phase === 'choosing' && s.gatePaused]}>
            <View style={s.gateH}>
              <Text style={[s.gateLbl, phase === 'choosing' && { color: C.warn }]}>
                {phase === 'choosing'
                  ? 'Held while you decide'
                  : consent === 'autopilot'
                    ? 'Booking unless you stop us'
                    : 'Waiting for you'}
              </Text>
              <Text style={[s.cd, phase === 'choosing' && { color: C.warn }]}>{left}s</Text>
            </View>
            <View style={s.bar}>
              <View
                style={[
                  s.barFill,
                  {
                    width: `${(left / QUIET_WINDOW_SECONDS) * 100}%`,
                    backgroundColor: phase === 'choosing' ? C.warn : C.iris,
                  },
                ]}
              />
            </View>

            {phase === 'waiting' ? (
              <>
                <Text style={s.gateP}>
                  Here is the whole plan — the flight, the room and both cab legs.
                  {consent === 'autopilot'
                    ? ' If you say nothing, we book all of it.'
                    : ' We will not book any of it until you say so.'}
                </Text>

                <Grp label="Flight">
                  <Line
                    ic="✈"
                    t1={`${pick.code} · ${pick.dep}`}
                    t2={`arrives ${pick.arr} · ${pick.cabin} · seat 14C`}
                    r={pick.fare ? money(pick.fare) : 'no cost'}
                    free={!pick.fare}
                  />
                </Grp>

                <Grp label="Room tonight">
                  <Line
                    ic="BED"
                    t1={hotel.name}
                    t2={`${hotel.area} · check-in ${hotel.checkin} · ${hotel.walk}`}
                    r={hotel.extra ? money(hotel.extra) : 'airline pays'}
                    free={!hotel.extra}
                  />
                </Grp>

                <Grp label={`Cab · ${cab.kind}`}>
                  {world.cabLegs.map((l) => (
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
                  <TouchableOpacity style={[s.btn, s.btnGo]} onPress={approve} activeOpacity={0.85}>
                    <Text style={s.btnGoTxt}>Yes, book it now</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.btn} onPress={browse} activeOpacity={0.7}>
                    <Text style={s.btnTxt}>Show me other options</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.btn} onPress={handOver} activeOpacity={0.7}>
                    <Text style={s.btnTxt}>I&apos;ll take it from here</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={s.gateP}>
                  {bookable.length} of {world.alts.length} work for you. The rest are blocked by your own
                  policy — we&apos;ll tell you which rule, not just &ldquo;unavailable&rdquo;.
                </Text>

                <Text style={s.grpLbl}>Flights</Text>
                {world.alts.map((a) => {
                  const excluded = rejected.includes(a.id);
                  const usable = a.ok && !excluded;
                  return (
                    <Opt
                      key={a.id}
                      usable={usable}
                      picked={a.id === chosen}
                      onPress={() => choose(a.id)}
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
                {world.hotels.map((h) => (
                  <Opt
                    key={h.id}
                    usable={h.ok}
                    picked={h.id === hotelId}
                    onPress={() => { setHotelId(h.id); setNote(`Room swapped to ${h.name}.`); }}
                    fl={h.name}
                    mt={h.ok ? `${h.area} · check-in ${h.checkin}` : h.why}
                    pr={h.ok ? (h.extra ? `${money(h.extra)} over` : 'airline pays') : 'over the cap'}
                    free={h.ok && !h.extra}
                  />
                ))}

                <Text style={[s.grpLbl, { marginTop: 18 }]}>Cab for both legs</Text>
                {world.cabs.map((c) => (
                  <Opt
                    key={c.id}
                    usable={c.ok}
                    picked={c.id === cabId}
                    onPress={() => { setCabId(c.id); setNote(`Cab swapped to ${c.kind}.`); }}
                    fl={c.kind}
                    mt={c.ok ? `up to ${c.seats} seats · ${c.why}` : c.why}
                    pr={c.ok ? (c.extra ? `${money(c.extra)} over` : 'airline pays') : 'over the cap'}
                    free={c.ok && !c.extra}
                  />
                ))}

                <View style={[s.acts, { marginTop: 16 }]}>
                  <TouchableOpacity style={[s.btn, s.btnGo]} onPress={approve} activeOpacity={0.85}>
                    <Text style={s.btnGoTxt}>Book this plan</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.btn} onPress={() => setPhase('waiting')} activeOpacity={0.7}>
                    <Text style={s.btnTxt}>Back to the plan</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        )}

        {phase === 'handed' && (
          <View style={[s.gate, s.gateStopped]}>
            <View style={s.gateH}>
              <Text style={[s.gateLbl, { color: C.risk }]}>Stopped</Text>
            </View>
            <Text style={s.gateP}>{note}</Text>
            <Cta label="Back to my flights" ghost onPress={() => navigation.navigate('Flights')} />
          </View>
        )}
      </Glass>

      {/* ── once it is booked, nothing above is changeable any more ──── */}
      {phase === 'booked' && (
        <>
          <Glass style={s.done}>
            <Eyebrow color={C.safe}>Your trip now</Eyebrow>
            <Diff k1="Flight" v1={`${world.upcoming[0].code} · ${world.upcoming[0].dep}`} k2="Rebooked" v2={`${pick.code} · ${pick.dep}`} first />
            <Diff k1="Hotel" v1={`${world.hotels[0].name}, 14:00`} k2={hotel.id === 'h1' ? 'Re-timed' : 'Changed'} v2={`${hotel.name}, ${hotel.checkin}`} />
            <Diff k1="Cab" v1={world.cabs[0].kind} k2={cab.id === 'c1' ? 'Re-timed' : 'Upgraded'} v2={`${cab.kind}, both legs`} />
            <Diff k1="Record locator" v1="QK7R2M" k2="Reissued" v2="RB4T9Z" />
            <Diff k1="London leg" v1={`${world.upcoming[1].code} · ${world.upcoming[1].dep}`} k2="Unchanged" v2="still valid" />
          </Glass>

          <Glass style={{ padding: 18 }}>
            <Eyebrow>What it cost you</Eyebrow>
            <KV first k="Flight fare difference" v={pick.fare ? money(pick.fare) : 'airline pays'} ok={!pick.fare} warn={!!pick.fare} />
            <KV k={`Room · ${hotel.name}`} v={hotel.extra ? `${money(hotel.extra)} over the allowance` : 'airline pays'} ok={!hotel.extra} warn={!!hotel.extra} />
            <KV k={`Cab · ${cab.kind}, both legs`} v={cab.extra ? `${money(cab.extra)} over the allowance` : 'airline pays'} ok={!cab.extra} warn={!!cab.extra} />
            <KV total k="Charged to your card" v={owed ? money(owed) : 'nothing'} ok={!owed} warn={!!owed} />
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
          <Text style={s.evT}>{secs(d)}</Text>
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
