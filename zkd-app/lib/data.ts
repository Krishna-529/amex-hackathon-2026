import { mins, days, hhmm, ddMon, dayLabel, agoLabel, durLabel } from './time';

export type Flight = {
  id: string;
  code: string;
  from: string;
  to: string;
  dep: string;
  arr: string;
  dur: string;
  date: string;
  aircraft?: string;
  terminal?: string;
  seat?: string;
  pnr?: string;
  /**
   * Epoch ms the member actually booked. A reschedule is only visible as a diff
   * against this — the carrier's own "delay" resets to zero once it moves the
   * schedule, so the booked time is the only fixed point we have.
   */
  bookedDepartureAt?: number;
  /** minutes of slack before the onward leg is missed; null when there is none */
  connectionSlackMinutes?: number | null;
  /** the trip breaks if this leg arrives late — a board meeting, an onward flight */
  hasHardConstraint?: boolean;
  /** whether this leg is watched at all — past flights are not */
  watched?: boolean;
};

export type PastFlight = Flight & {
  outcome: 'ontime' | 'delayed' | 'cancelled';
  detail: string;
  exact: string;
  recovered?: string;
};

export type HotelOpt = {
  id: string; name: string; area: string; checkin: string;
  rate: number; extra: number; currency: string;
  ok: boolean; why: string; walk: string;
};

export type CabOpt = {
  id: string; kind: string; seats: number; extra: number; currency: string;
  ok: boolean; why: string;
};

/** the two legs the cab has to cover, whichever vehicle you pick */
export type CabLeg = { id: string; from: string; to: string; pickup: string; note: string };

export type Alt = {
  id: string;
  code: string;
  dep: string;
  arr: string;
  cabin: string;
  seats: number;
  fare: number;
  /** never assume one country's money */
  currency: string;
  international?: boolean;
  ok: boolean;
  why: string;
};

/** Everything a screen needs, built from one `now`. */
export function buildWorld(now: Date) {
  const detected = mins(now, -2); // the cancellation just landed
  const dep1 = mins(now, 168); // AI 2803 was due to leave in 2h 48m

  const mk = (o: {
    id: string;
    code: string;
    from: string;
    to: string;
    _dep: Date;
    _mins: number;
    aircraft: string;
    terminal: string;
    seat: string;
    pnr: string;
    connectionSlackMinutes: number | null;
    hasHardConstraint: boolean;
  }): Flight => ({
    ...o,
    dep: hhmm(o._dep),
    arr: hhmm(mins(o._dep, o._mins)),
    dur: durLabel(o._mins),
    date: dayLabel(o._dep, now),
    bookedDepartureAt: o._dep.getTime(),
    watched: true,
  });

  const upcoming: Flight[] = [
    // The Chennai leg feeds the London connection: 380 min between departures,
    // 160 in the air, so 220 minutes of slack before the onward leg is missed.
    mk({
      id: 'u1', code: 'AI 2803', from: 'MAA', to: 'DEL', _dep: dep1, _mins: 160,
      aircraft: 'A320neo', terminal: 'T1', seat: '14C', pnr: 'QK7R2M',
      connectionSlackMinutes: 220, hasHardConstraint: true,
    }),
    mk({
      id: 'u2', code: 'AI 2201', from: 'DEL', to: 'LHR', _dep: mins(dep1, 380), _mins: 555,
      aircraft: 'B787-9', terminal: 'T3', seat: '22A', pnr: 'QK7R2M',
      connectionSlackMinutes: null, hasHardConstraint: true,
    }),
    mk({
      id: 'u3', code: '6E 5192', from: 'BOM', to: 'DEL', _dep: days(mins(dep1, -60), 17), _mins: 135,
      aircraft: 'A320', terminal: 'T2', seat: '8F', pnr: 'LP4XZ1',
      connectionSlackMinutes: null, hasHardConstraint: false,
    }),
  ];

  const mkPast = (o: {
    id: string; code: string; from: string; to: string;
    _h: number; _m: number; _mins: number; _ago: number;
    outcome: PastFlight['outcome']; detail: string; recovered?: string;
  }): PastFlight => {
    const d = days(now, -o._ago);
    const dep = new Date(d);
    dep.setHours(o._h, o._m, 0, 0);
    return {
      ...o,
      dep: hhmm(dep),
      arr: hhmm(mins(dep, o._mins)),
      dur: durLabel(o._mins),
      date: agoLabel(d, now),
      exact: `${ddMon(d)} ${d.getFullYear()}`,
    };
  };

  const past: PastFlight[] = [
    mkPast({ id: 'p1', code: '6E 6402', from: 'CCU', to: 'DEL', _h: 5, _m: 0, _mins: 140, _ago: 47,
      outcome: 'cancelled', detail: 'Cancelled 50 minutes before departure · rebooked automatically',
      recovered: 'We put you on 6E 812 three hours later and the airline covered the fare.' }),
    mkPast({ id: 'p2', code: 'AI 803', from: 'DEL', to: 'BLR', _h: 18, _m: 30, _mins: 165, _ago: 66,
      outcome: 'delayed', detail: 'Departed 2h 10m late' }),
    mkPast({ id: 'p3', code: 'UK 996', from: 'BLR', to: 'DEL', _h: 7, _m: 45, _mins: 165, _ago: 69,
      outcome: 'ontime', detail: 'On time' }),
    mkPast({ id: 'p4', code: '6E 2117', from: 'DEL', to: 'GAU', _h: 6, _m: 0, _mins: 150, _ago: 236,
      outcome: 'cancelled', detail: 'Delhi weather closure',
      recovered: 'No same-day seat existed. We booked you a hotel and the first flight next morning.' }),
    mkPast({ id: 'p5', code: 'AI 2803', from: 'MAA', to: 'DEL', _h: 7, _m: 0, _mins: 160, _ago: 250,
      outcome: 'ontime', detail: 'On time' }),
    mkPast({ id: 'p6', code: 'SG 8169', from: 'DEL', to: 'MAA', _h: 21, _m: 10, _mins: 165, _ago: 267,
      outcome: 'delayed', detail: 'Departed 55m late' }),
    mkPast({ id: 'p7', code: 'AI 2803', from: 'MAA', to: 'DEL', _h: 7, _m: 0, _mins: 160, _ago: 322,
      outcome: 'ontime', detail: 'On time' }),
    mkPast({ id: 'p8', code: '6E 5192', from: 'BOM', to: 'DEL', _h: 6, _m: 0, _mins: 135, _ago: 401,
      outcome: 'ontime', detail: 'On time' }),
  ];

  const rollsOver = (d: Date) => d.getDate() !== dep1.getDate();
  const mkAlt = (o: {
    id: string; _dep: Date; code: string; cabin: string; seats: number; fare: number;
    currency: string; ok: boolean; why: string;
  }): Alt => ({
    ...o,
    dep: hhmm(o._dep) + (rollsOver(o._dep) ? ' +1' : ''),
    arr: hhmm(mins(o._dep, 160)) + (rollsOver(mins(o._dep, 160)) ? ' +1' : ''),
  });

  const alts: Alt[] = [
    mkAlt({ id: 'a1', _dep: mins(dep1, 180), code: 'AI 415', cabin: 'Economy', seats: 3, fare: 0,
      currency: 'INR',
      ok: true, why: 'Same carrier, economy, still connects to your London leg' }),
    mkAlt({ id: 'a2', _dep: mins(dep1, 360), code: 'UK 820', cabin: 'Business', seats: 6, fare: 41200,
      currency: 'INR',
      ok: false, why: 'Business exceeds your entitled cabin' }),
    mkAlt({ id: 'a3', _dep: mins(dep1, 540), code: 'SG 423', cabin: 'Economy', seats: 5, fare: 0,
      currency: 'INR',
      ok: true, why: 'Different carrier, lands after your London departure — the connection would break' }),
    mkAlt({ id: 'a4', _dep: mins(dep1, 900), code: 'AI 973', cabin: 'Economy', seats: 9, fare: 0,
      currency: 'INR',
      ok: false, why: 'Departs past your travel window' }),
  ];

  /* the hotel has to move with the flight — it is the same decision */
  const hotels: HotelOpt[] = [
    { id: 'h1', name: 'Andaz Delhi Aerocity', area: 'Aerocity · 8 min from T3',
      checkin: '16:30', rate: 0, extra: 0, currency: 'INR', ok: true, walk: 'Your existing booking, re-timed',
      why: 'Same property, same rate — we only moved the check-in time' },
    { id: 'h2', name: 'Roseate House', area: 'Aerocity · 10 min from T3',
      checkin: '17:00', rate: 0, extra: 2400, currency: 'INR', ok: true, walk: 'New booking',
      why: 'Airline-covered up to your entitlement; ₹2,400 over' },
    { id: 'h3', name: 'The Leela Palace', area: 'Chanakyapuri · 40 min from T3',
      checkin: '17:00', rate: 0, extra: 14800, currency: 'INR', ok: false, walk: 'New booking',
      why: 'Beyond the duty-of-care rate the airline will reimburse' },
  ];

  const cabLegs: CabLeg[] = [
    { id: 'l1', from: 'DEL T3', to: 'Andaz Aerocity', pickup: hhmm(mins(dep1, 320)),
      note: 'Re-timed around your new arrival' },
    { id: 'l2', from: 'Andaz Aerocity', to: 'DEL T3', pickup: '09:40',
      note: 'Re-timed for your London departure' },
  ];

  const cabs: CabOpt[] = [
    { id: 'c1', kind: 'Sedan', seats: 3, extra: 0, currency: 'INR', ok: true,
      why: 'Within the transfer allowance the airline reimburses' },
    { id: 'c2', kind: 'SUV', seats: 6, extra: 900, currency: 'INR', ok: true,
      why: 'More boot space for your London bags · ₹900 over the allowance' },
    { id: 'c3', kind: 'Chauffeured luxury', seats: 3, extra: 6200, currency: 'INR', ok: false,
      why: 'Beyond the transfer allowance the airline will reimburse' },
  ];

  return { now, detected, upcoming, past, alts, hotels, cabs, cabLegs };
}

export type World = ReturnType<typeof buildWorld>;

/**
 * The member's identity, preferences and payment used to be a constant here.
 * They now come from MyCa (server/myca.ts), which is the card's own system of
 * record — keeping a second copy here would drift from the card, and we would
 * end up ranking flights against entitlements the member no longer has.
 */

export function routeRecord(past: PastFlight[], from: string, to: string) {
  const rows = past.filter((p) => p.from === from && p.to === to);
  return { flown: rows.length, cancelled: rows.filter((p) => p.outcome === 'cancelled').length };
}

export const OUTCOME = {
  ontime: { cls: 'done', label: 'On time' },
  delayed: { cls: 'mid', label: 'Delayed' },
  cancelled: { cls: 'high', label: 'Cancelled' },
} as const;
