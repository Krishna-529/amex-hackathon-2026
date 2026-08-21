/**
 * The domain data store — Postgres-backed, JSONB-per-aggregate (see
 * server/domain/migrations/0001_init.sql and zkd-app/README.md for the
 * schema and why). Used to be process-lifetime `Map`s; that meant two
 * Fargate tasks behind the ALB (zkd-risk-model/infra/app.tf's
 * `app_desired_count`) would each hold independent state, so a disruption
 * event created on the task that handled request 1 would be invisible to
 * the task that handles request 2. Every exported function here now reads
 * from and writes to the one shared database instead, so `app_desired_count
 * > 1` is actually correct.
 *
 * Every function that used to read/write a Map is now `async`, returning a
 * `Promise` of exactly what it returned before — same parameter shapes,
 * same return shapes, just awaited. The few pure/derived functions that only
 * operate on an already-fetched object (`partySize`, `routeRecord`'s inner
 * math) stay synchronous where they genuinely don't touch the database —
 * see each function's comment.
 *
 * `create*` functions double as upserts: every one of them (bar
 * `createCredential`, which keeps its explicit no-op-on-duplicate-email
 * check) does a plain `INSERT ... ON CONFLICT (id) DO UPDATE`, exactly
 * mirroring the old `map.set(id, value)` — which was already effectively an
 * upsert with no existence check. That is deliberate: several call sites
 * (server/engine/forecast.ts, altsCache.ts, groundCache.ts,
 * server/engine/simulation.ts's finishDecide) fetch an object, mutate it in
 * place, and need to persist that mutation back — re-calling the same
 * `create*` function they already use is that persistence call, so no new
 * exported "update" methods were needed for those cases.
 */
import { sql, ensureReady } from './db.ts';
import type {
  Passenger, Flight, Booking, Itinerary, PreAuthRecord, PastFlight,
  DisruptionEvent, RecoveryTask, Credential, Traveller, SeatAssignment,
  Stay, Ride, JourneyPrefs,
} from './types';
import type { PipelineRun } from '../pipeline/types';

async function db() {
  await ensureReady();
  return sql;
}

/**
 * Pipeline runs stay in-memory (not Postgres-backed like everything else in
 * this file) — they're per-process orchestration state for one rebooking
 * attempt, not a durable booking record, so they inherit the same
 * process-lifetime caveat the rest of this store used to have before the
 * Postgres migration, rather than needing a new migration of their own.
 */
export const pipelineRuns = new Map<string, PipelineRun>(); // key: `${flightId}:${passengerId}`

// ---------------------------------------------------------------- flights --

/**
 * Risk is still a standing prediction on every upcoming flight, but it is no
 * longer computed here: the forecast is bought from a vendor, so it arrives
 * asynchronously and is cached onto the Flight by server/engine/forecast.ts.
 * Creation stays logically synchronous-at-the-call-site in spirit (nothing
 * here computes anything), just now an awaited write — and doubles as the
 * persistence call for every in-place Flight mutation elsewhere (forecast
 * caching, alt/ground cache refreshes): see this file's header comment.
 */
export async function createFlight(f: Flight): Promise<void> {
  const q = await db();
  await q`
    insert into flights (id, dep_iso, data)
    values (${f.id}, ${f.depISO}, ${q.json(f)})
    on conflict (id) do update set dep_iso = excluded.dep_iso, data = excluded.data
  `;
}

export async function listFlights(): Promise<Flight[]> {
  const q = await db();
  const rows = await q<{ data: Flight }[]>`select data from flights order by dep_iso asc`;
  return rows.map((r) => r.data);
}

export async function getFlight(id: string): Promise<Flight | undefined> {
  const q = await db();
  const rows = await q<{ data: Flight }[]>`select data from flights where id = ${id}`;
  return rows[0]?.data;
}

export async function deleteFlight(id: string): Promise<void> {
  const q = await db();
  await q`delete from flights where id = ${id}`;
}

/**
 * Demo reset: send every triggered flight back to "watching" by wiping all
 * disruption/recovery/pre-auth rows and the in-process pipeline runs. Static
 * data (bookings, passengers, past flights) is untouched — a recovery never
 * deletes those, it only layers disruption/recovery state on top.
 */
/**
 * Transaction added 2026-08-21 — the three deletes used to be separate
 * round trips; a crash mid-reset (demo-reset is a real, user-triggerable
 * action) could leave stale `recovery_tasks`/`pre_auths` rows after
 * `disruption_events` was already gone, with nothing to reconcile them.
 * Demo-reset-only path (lower stakes than the money-adjacent writes
 * elsewhere in this file), but cheap to make correctly atomic.
 */
export async function clearDisruptionState(): Promise<void> {
  const q = await db();
  await q.begin(async (tx) => {
    await tx`delete from recovery_tasks`;
    await tx`delete from disruption_events`;
    await tx`delete from pre_auths`;
  });
  pipelineRuns.clear();
}

// -------------------------------------------------------------- passengers --

export async function createPassenger(p: Passenger): Promise<void> {
  const q = await db();
  await q`
    insert into passengers (id, data) values (${p.id}, ${q.json(p)})
    on conflict (id) do update set data = excluded.data
  `;
}

export async function listPassengers(): Promise<Passenger[]> {
  const q = await db();
  const rows = await q<{ data: Passenger }[]>`select data from passengers`;
  return rows.map((r) => r.data);
}

export async function getPassenger(id: string): Promise<Passenger | undefined> {
  const q = await db();
  const rows = await q<{ data: Passenger }[]>`select data from passengers where id = ${id}`;
  return rows[0]?.data;
}

/**
 * Fixed 2026-08-21 — was a real lost-update race: read the whole passenger,
 * mutate `.consent` in application code, blind-write the whole document
 * back. Two concurrent consent changes for the same passenger (a member
 * toggling autopilot on two devices, or a UI edit racing a MyCa sync) could
 * silently drop one — including, worst case, a real "ask me first" ->
 * autopilot DOWNGRADE being lost, leaving a member on autopilot when they
 * explicitly asked to be consulted. `jsonb_set` inside the UPDATE makes this
 * genuinely atomic: Postgres applies it to whatever the row's CURRENT value
 * is under row-level locking, not a stale snapshot read earlier in this
 * function — there is no read-modify-write window for a second writer to
 * land inside. `RETURNING data` gets the fresh document back in the same
 * round trip rather than returning the pre-update value this function used
 * to hand back.
 */
export async function updateConsent(passengerId: string, consent: Passenger['consent']): Promise<Passenger | undefined> {
  const q = await db();
  const rows = await q<{ data: Passenger }[]>`
    update passengers
    set data = jsonb_set(data, '{consent}', to_jsonb(${consent}::text))
    where id = ${passengerId}
    returning data
  `;
  return rows[0]?.data;
}

// ------------------------------------------------------------- credentials --

export async function createCredential(c: Credential): Promise<void> {
  const q = await db();
  const key = c.email.toLowerCase();
  // no-op on duplicate email — a seed-time invariant, not a runtime path
  await q`
    insert into credentials (email, passenger_id, data) values (${key}, ${c.passengerId}, ${q.json(c)})
    on conflict (email) do nothing
  `;
}

export async function findCredentialByEmail(email: string): Promise<Credential | undefined> {
  const q = await db();
  const rows = await q<{ data: Credential }[]>`select data from credentials where email = ${email.toLowerCase()}`;
  return rows[0]?.data;
}

export async function getCredentialForPassenger(id: string): Promise<Credential | undefined> {
  const q = await db();
  const rows = await q<{ data: Credential }[]>`select data from credentials where passenger_id = ${id} limit 1`;
  return rows[0]?.data;
}

// -------------------------------------------------------------- travellers --

export async function createTraveller(t: Omit<Traveller, 'id'>): Promise<Traveller> {
  const q = await db();
  const [{ nextval }] = await q<{ nextval: string }[]>`select nextval('traveller_seq') as nextval`;
  const traveller: Traveller = { ...t, id: `tr${nextval}` };
  await q`insert into travellers (id, data) values (${traveller.id}, ${q.json(traveller)})`;
  return traveller;
}

export async function getTraveller(id: string): Promise<Traveller | undefined> {
  const q = await db();
  const rows = await q<{ data: Traveller }[]>`select data from travellers where id = ${id}`;
  return rows[0]?.data;
}

/** Fetched one id at a time (rather than a single WHERE id IN (...) query)
 *  so the result stays in `b.travellerIds` order, matching the old
 *  `.map(id => travellers.get(id)).filter(Boolean)` exactly — a party's
 *  cardholder-first ordering elsewhere in the app depends on that. Parties
 *  are small (single digits), so this is a handful of queries, not a
 *  scalability concern. */
export async function getTravellersForBooking(b: Booking): Promise<Traveller[]> {
  const list = await Promise.all(b.travellerIds.map((id) => getTraveller(id)));
  return list.filter((t): t is Traveller => Boolean(t));
}

/** Derived, never stored — so it can never drift from the traveller list
 *  itself. Operates only on an already-fetched Booking, never touches the
 *  database, so it stays synchronous. */
export function partySize(b: Booking): number {
  return b.travellerIds.length || 1;
}

/**
 * Back-fills a solo party when the caller (e.g. the /ops flight-creation form)
 * supplies no travellers: one Traveller synthesised from the passenger's own
 * record, so every Booking has a real party of at least one without every
 * construction site having to remember to build it.
 */
export async function createBooking(b: Omit<Booking, 'id' | 'travellerIds' | 'seats'> & {
  travellerIds?: string[];
  seats?: SeatAssignment[];
}): Promise<Booking> {
  const q = await db();
  let travellerIds = b.travellerIds;
  let seats = b.seats;

  if (!travellerIds || travellerIds.length === 0) {
    const p = await getPassenger(b.passengerId);
    const solo = await createTraveller({
      passengerId: b.passengerId,
      displayName: p?.displayName ?? b.passengerId,
      legalName: p?.legalName ?? p?.displayName ?? b.passengerId,
      dob: p?.dob ?? '—',
      gender: p?.gender ?? '—',
      nationality: p?.nationality ?? 'Indian',
      passport: p?.passport ?? { number: '—', expiry: '—', issued: '—' },
      contact: p?.contact ?? { email: '—', phone: '—' },
      type: 'adult',
      loyalty: p?.loyalty ?? [],
    });
    travellerIds = [solo.id];
    seats = [{ travellerId: solo.id, seat: b.seat }];
  }

  const [{ nextval }] = await q<{ nextval: string }[]>`select nextval('booking_seq') as nextval`;
  const booking: Booking = { ...b, id: `bk${nextval}`, travellerIds, seats: seats ?? [] };
  await q`
    insert into bookings (id, passenger_id, flight_id, data)
    values (${booking.id}, ${booking.passengerId}, ${booking.flightId}, ${q.json(booking)})
  `;
  return booking;
}

export async function getBookingsForFlight(flightId: string): Promise<Booking[]> {
  const q = await db();
  const rows = await q<{ data: Booking }[]>`select data from bookings where flight_id = ${flightId}`;
  return rows.map((r) => r.data);
}

export async function getBooking(id: string): Promise<Booking | undefined> {
  const q = await db();
  const rows = await q<{ data: Booking }[]>`select data from bookings where id = ${id}`;
  return rows[0]?.data;
}

/**
 * Fixed 2026-08-21 — was a real atomicity gap: the itinerary insert and each
 * booking's itineraryId/legIndex update were separate, un-transacted round
 * trips. A crash mid-loop left `Itinerary.bookingIds` and each
 * `Booking.itineraryId`/`legIndex` permanently disagreeing — a real,
 * silent data-consistency bug (the schedule join in
 * `getScheduleForPassenger` trusts `Booking.itineraryId`, so an orphaned
 * booking would render out of order or drop off a multi-leg itinerary's
 * display). Now one real Postgres transaction: either every write lands, or
 * none do — the same guarantee `seed.ts`'s advisory-lock pattern already
 * gives the migration runner, applied here to a genuine multi-step write.
 */
export async function createItinerary(passengerId: string, bookingIds: string[]): Promise<Itinerary> {
  const q = await db();
  return q.begin(async (tx) => {
    const [{ nextval }] = await tx<{ nextval: string }[]>`select nextval('itinerary_seq') as nextval`;
    const it: Itinerary = { id: `it${nextval}`, passengerId, bookingIds };
    await tx`insert into itineraries (id, passenger_id, data) values (${it.id}, ${passengerId}, ${tx.json(it)})`;

    for (let i = 0; i < bookingIds.length; i += 1) {
      const rows = await tx<{ data: Booking }[]>`select data from bookings where id = ${bookingIds[i]}`;
      const b = rows[0]?.data;
      if (b) {
        b.itineraryId = it.id;
        b.legIndex = i;
        await tx`update bookings set passenger_id = ${b.passengerId}, flight_id = ${b.flightId}, data = ${tx.json(b)} where id = ${b.id}`;
      }
    }
    return it;
  });
}

/** A passenger's upcoming flights (their "schedule"), joined Booking → Flight, soonest first. */
export async function getScheduleForPassenger(passengerId: string): Promise<{ booking: Booking; flight: Flight }[]> {
  const q = await db();
  const rows = await q<{ data: Booking }[]>`select data from bookings where passenger_id = ${passengerId}`;
  const joined = await Promise.all(
    rows.map(async (r) => ({ booking: r.data, flight: await getFlight(r.data.flightId) })),
  );
  return joined
    .filter((row): row is { booking: Booking; flight: Flight } => Boolean(row.flight))
    .sort((a, b) => a.flight.depISO.localeCompare(b.flight.depISO));
}

/** The next leg after this booking in its itinerary, if any — for "onward leg verified" narration. */
export async function getNextLeg(bookingId: string): Promise<{ booking: Booking; flight: Flight } | null> {
  const b = await getBooking(bookingId);
  if (!b?.itineraryId) return null;
  const q = await db();
  const rows = await q<{ data: Itinerary }[]>`select data from itineraries where id = ${b.itineraryId}`;
  const it = rows[0]?.data;
  if (!it) return null;
  const nextId = it.bookingIds[(b.legIndex ?? 0) + 1];
  if (!nextId) return null;
  const nb = await getBooking(nextId);
  const nf = nb ? await getFlight(nb.flightId) : undefined;
  return nb && nf ? { booking: nb, flight: nf } : null;
}

// -------------------------------------------------------------- pre-auths --

export async function getPreAuth(flightId: string, passengerId: string): Promise<PreAuthRecord | undefined> {
  const q = await db();
  const rows = await q<{ data: PreAuthRecord }[]>`select data from pre_auths where key = ${`${flightId}:${passengerId}`}`;
  return rows[0]?.data;
}

/**
 * Every pre-auth for one flight, in one indexed query. Added 2026-08-21:
 * `altsCache.ts`'s `mergePinned` used to find these by calling
 * `listPassengers()` (the ENTIRE passenger table, system-wide) then issuing
 * one `getPreAuth` per passenger — a true N+1 that ran on every alts refresh
 * (which can fire every 20s during a real disruption). `pre_auths` already
 * carries a `flight_id` column for exactly this query; nothing used it.
 */
export async function getPreAuthsForFlight(flightId: string): Promise<PreAuthRecord[]> {
  const q = await db();
  const rows = await q<{ data: PreAuthRecord }[]>`select data from pre_auths where flight_id = ${flightId}`;
  return rows.map((r) => r.data);
}

export async function setPreAuth(rec: PreAuthRecord): Promise<void> {
  const q = await db();
  const key = `${rec.flightId}:${rec.passengerId}`;
  await q`
    insert into pre_auths (key, flight_id, passenger_id, data) values (${key}, ${rec.flightId}, ${rec.passengerId}, ${q.json(rec)})
    on conflict (key) do update set data = excluded.data
  `;
}

export async function clearPreAuth(flightId: string, passengerId: string): Promise<void> {
  const q = await db();
  await q`delete from pre_auths where key = ${`${flightId}:${passengerId}`}`;
}

// ------------------------------------------------------- journey prefs --
// A member's temporary, per-flight window + consent choice. Same storage shape
// as pre_auths above (one row per flight+passenger, JSON blob) — deliberately,
// because it is the same kind of thing: an advance instruction for one flight
// that is discarded with it, never merged into the durable MyCa profile.

export async function getJourneyPrefs(flightId: string, passengerId: string): Promise<JourneyPrefs | undefined> {
  const q = await db();
  const rows = await q<{ data: JourneyPrefs }[]>`select data from journey_prefs where key = ${`${flightId}:${passengerId}`}`;
  return rows[0]?.data;
}

export async function setJourneyPrefs(rec: JourneyPrefs): Promise<void> {
  const q = await db();
  const key = `${rec.flightId}:${rec.passengerId}`;
  await q`
    insert into journey_prefs (key, flight_id, passenger_id, data) values (${key}, ${rec.flightId}, ${rec.passengerId}, ${q.json(rec)})
    on conflict (key) do update set data = excluded.data
  `;
}

export async function clearJourneyPrefs(flightId: string, passengerId: string): Promise<void> {
  const q = await db();
  await q`delete from journey_prefs where key = ${`${flightId}:${passengerId}`}`;
}

// ------------------------------------------------------------ past flights --

export async function getPastFlights(passengerId: string): Promise<PastFlight[]> {
  const q = await db();
  const rows = await q<{ data: PastFlight[] }[]>`select data from past_flights where passenger_id = ${passengerId}`;
  return rows[0]?.data ?? [];
}

export async function setPastFlights(passengerId: string, rows: PastFlight[]): Promise<void> {
  const q = await db();
  await q`
    insert into past_flights (passenger_id, data) values (${passengerId}, ${q.json(rows)})
    on conflict (passenger_id) do update set data = excluded.data
  `;
}

/** Per-route cancellation record for a passenger, same math as the old routeRecord() in lib/data.ts. */
export async function routeRecord(passengerId: string, from: string, to: string) {
  const rows = (await getPastFlights(passengerId)).filter((p) => p.from === from && p.to === to);
  return { flown: rows.length, cancelled: rows.filter((p) => p.outcome === 'cancelled').length };
}

// -------------------------------------------------------- disruption events --

export async function getDisruptionEvent(flightId: string): Promise<DisruptionEvent | undefined> {
  const q = await db();
  const rows = await q<{ data: DisruptionEvent }[]>`select data from disruption_events where flight_id = ${flightId}`;
  return rows[0]?.data;
}

/** Upsert, same as createFlight above — server/engine/simulation.ts's
 *  finishDecide() fetches an event, mutates `phase`/`decidedAt` in place,
 *  and calls this again to persist that mutation; there was never a
 *  uniqueness check here (map.set(ev.flightId, ev) was always an
 *  overwrite), so no separate "update" export was needed. */
export async function createDisruptionEvent(ev: DisruptionEvent): Promise<void> {
  const q = await db();
  await q`
    insert into disruption_events (flight_id, data) values (${ev.flightId}, ${q.json(ev)})
    on conflict (flight_id) do update set data = excluded.data
  `;
}

export async function listDisruptionEvents(): Promise<DisruptionEvent[]> {
  const q = await db();
  const rows = await q<{ data: DisruptionEvent }[]>`select data from disruption_events`;
  return rows.map((r) => r.data);
}

// ----------------------------------------------------------- recovery tasks --

export async function nextTaskId(): Promise<string> {
  const q = await db();
  const [{ nextval }] = await q<{ nextval: string }[]>`select nextval('task_seq') as nextval`;
  return `rt${nextval}`;
}

export async function getRecoveryTask(flightId: string, passengerId: string): Promise<RecoveryTask | undefined> {
  const q = await db();
  const rows = await q<{ data: RecoveryTask }[]>`select data from recovery_tasks where key = ${`${flightId}:${passengerId}`}`;
  return rows[0]?.data;
}

export async function setRecoveryTask(task: RecoveryTask): Promise<void> {
  const q = await db();
  const key = `${task.flightId}:${task.passengerId}`;
  await q`
    insert into recovery_tasks (key, flight_id, passenger_id, data) values (${key}, ${task.flightId}, ${task.passengerId}, ${q.json(task)})
    on conflict (key) do update set data = excluded.data
  `;
}

export async function getRecoveryTasksForFlight(flightId: string): Promise<RecoveryTask[]> {
  const q = await db();
  const rows = await q<{ data: RecoveryTask }[]>`select data from recovery_tasks where flight_id = ${flightId}`;
  return rows.map((r) => r.data);
}

/**
 * Every recovery task still waiting on a member with a window that has
 * already lapsed — the input to `simulation.ts`'s reconciliation sweep.
 * Added 2026-08-21: consent-window expiry has always been driven by a
 * `setTimeout` that lives only in process memory (`RecoveryTask.windowExpiresAt`
 * is persisted, the live timer that acts on it is not — see this file's own
 * header on `pipelineRuns`/process-lifetime state for the same class of gap).
 * Before this query existed, a process restart while any member had an open
 * consent window meant nothing anywhere would ever resume it — the task sat
 * at `phase:'waiting'`, `resolution:null` forever, with no automatic path
 * back to a decision. A JSONB path filter, not an indexed column — acceptable
 * for a periodic sweep at this table's current size; would want a real
 * generated/indexed column (`phase`, `resolution_kind`) before this runs
 * against a real member base.
 */
export async function listWaitingRecoveryTasks(): Promise<RecoveryTask[]> {
  const q = await db();
  // jsonb_typeof(...) = 'null', not `IS NULL` or `= 'null'::jsonb` — the `->`
  // operator returns the JSONB scalar `null` for a stored JSON null, which is
  // NOT the same thing as SQL NULL (a naive `IS NULL` here would silently
  // match nothing). jsonb_typeof is the standard, unambiguous way to ask
  // "is this JSON value actually null".
  const rows = await q<{ data: RecoveryTask }[]>`
    select data from recovery_tasks
    where data->>'phase' = 'waiting' and jsonb_typeof(data->'resolution') = 'null'
  `;
  return rows.map((r) => r.data);
}

/**
 * Pipeline runs live here rather than in a second store, so they inherit the
 * same process-lifetime caveat documented at the top of this file rather than
 * introducing a second, differently-broken persistence story.
 */
export function getPipelineRun(flightId: string, passengerId: string): PipelineRun | undefined {
  return pipelineRuns.get(`${flightId}:${passengerId}`);
}

export function setPipelineRun(run: PipelineRun) {
  pipelineRuns.set(`${run.flightId}:${run.passengerId}`, run);
}

export function getPipelineRunsForFlight(flightId: string): PipelineRun[] {
  return [...pipelineRuns.values()].filter((r) => r.flightId === flightId);
}

export function listPipelineRuns(): PipelineRun[] {
  return [...pipelineRuns.values()].sort((a, b) => b.startedAt - a.startedAt);
}

/* ── Stays and rides ───────────────────────────────────────────────────────
   Same storage shape as bookings — id, owner, entity as JSON — so nothing here
   introduces a new pattern to learn. See migrations/0002 for why they are not
   columns on `bookings`. */

export async function createStay(s: Omit<Stay, 'id'>): Promise<Stay> {
  const q = await db();
  const [{ nextval }] = await q<{ nextval: string }[]>`select nextval('stay_seq') as nextval`;
  const stay: Stay = { ...s, id: `st${nextval}` };
  await q`
    insert into stays (id, passenger_id, flight_id, data)
    values (${stay.id}, ${stay.passengerId}, ${stay.flightId}, ${q.json(stay)})
  `;
  return stay;
}

export async function getStaysForPassenger(passengerId: string): Promise<Stay[]> {
  const q = await db();
  const rows = await q<{ data: Stay }[]>`
    select data from stays where passenger_id = ${passengerId}
  `;
  // Soonest check-in first — a member looking at their trips cares about the
  // next night away, not the order they happened to book in.
  return rows.map((r) => r.data).sort((a, b) => a.checkin.localeCompare(b.checkin));
}

/** Used to keep a repeat confirmation from creating a second reservation for
 *  the same room on the same nights. */
export async function findStay(
  passengerId: string,
  city: string,
  checkin: string,
  name: string,
): Promise<Stay | undefined> {
  const stays = await getStaysForPassenger(passengerId);
  return stays.find((s) => s.city === city && s.checkin === checkin && s.name === name);
}

export async function createRide(r: Omit<Ride, 'id'>): Promise<Ride> {
  const q = await db();
  const [{ nextval }] = await q<{ nextval: string }[]>`select nextval('ride_seq') as nextval`;
  const ride: Ride = { ...r, id: `rd${nextval}` };
  await q`
    insert into rides (id, passenger_id, flight_id, data)
    values (${ride.id}, ${ride.passengerId}, ${ride.flightId}, ${q.json(ride)})
  `;
  return ride;
}

export async function getRidesForPassenger(passengerId: string): Promise<Ride[]> {
  const q = await db();
  const rows = await q<{ data: Ride }[]>`
    select data from rides where passenger_id = ${passengerId}
  `;
  return rows.map((r) => r.data).sort((a, b) => a.pickupISO.localeCompare(b.pickupISO));
}
