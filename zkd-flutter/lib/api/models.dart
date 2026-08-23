// Mirrors zkd-android/src/api.ts, which in turn mirrors the server's
// lib/apiTypes.ts contract.
//
// Everything parses defensively. The server sends fields the old TypeScript
// types never declared (`stays` on the schedule, `partySize`/`cost`/`pipeline`/
// `timings` on RecoveryView) and omits others entirely until they exist
// (`forecast` is absent until the first server refresh). Nothing here may throw
// on a shape it did not expect — the UI surfaces no errors, so a parse failure
// would present as a permanently blank screen.

String _s(dynamic v, [String fallback = '']) => v is String ? v : fallback;
String? _sn(dynamic v) => v is String ? v : null;
int _i(dynamic v, [int fallback = 0]) =>
    v is num ? v.toInt() : (v is String ? int.tryParse(v) ?? fallback : fallback);
int? _inull(dynamic v) => v is num ? v.toInt() : null;
double _d(dynamic v, [double fallback = 0]) =>
    v is num ? v.toDouble() : (v is String ? double.tryParse(v) ?? fallback : fallback);
bool _b(dynamic v, [bool fallback = false]) => v is bool ? v : fallback;
Map<String, dynamic> _m(dynamic v) =>
    v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};
List<Map<String, dynamic>> _list(dynamic v) => v is List
    ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
    : <Map<String, dynamic>>[];

/// UI tone. The forecast's own band is finer-grained; this is what colours things.
enum Tone { low, mid, high }

Tone toneFrom(String s) => switch (s) {
      'high' => Tone.high,
      'mid' => Tone.mid,
      _ => Tone.low,
    };

class Thresholds {
  final int prepare, holdGate, preAuthorise, seatsAvailable, minutesToDeparture;
  final bool hasHardConstraint;
  final double confidence;
  const Thresholds({
    required this.prepare,
    required this.holdGate,
    required this.preAuthorise,
    required this.seatsAvailable,
    required this.minutesToDeparture,
    required this.hasHardConstraint,
    required this.confidence,
  });

  factory Thresholds.fromJson(Map<String, dynamic> j) {
    final inputs = _m(j['inputs']);
    return Thresholds(
      prepare: _i(j['prepare']),
      holdGate: _i(j['holdGate']),
      preAuthorise: _i(j['preAuthorise']),
      seatsAvailable: _i(inputs['seatsAvailable']),
      minutesToDeparture: _i(inputs['minutesToDeparture']),
      hasHardConstraint: _b(inputs['hasHardConstraint']),
      confidence: _d(inputs['confidence']),
    );
  }
}

/// The disruption forecast, exactly as the server sends it. The probability is
/// bought from a vendor; the phone is a viewer of that number, never a second
/// place it gets computed.
class FlightForecast {
  final int pct;

  /// 0-100 PERCENTILE rank against the model's live score distribution — NOT a
  /// probability. A flight at 72/100 had a `pct` of 4%. The web app shows this
  /// number, so the phone must too, or the same flight reads differently on two
  /// screens side by side. Nullable: older cached responses omit it.
  final double? riskScore;
  final String band; // watch | prepare | hold-gate | pre-authorise
  final Tone tone;
  final double? connectionRisk;
  final double confidence;
  final String source; // lumo | mock
  final Thresholds thresholds;

  const FlightForecast({
    required this.pct,
    required this.riskScore,
    required this.band,
    required this.tone,
    required this.connectionRisk,
    required this.confidence,
    required this.source,
    required this.thresholds,
  });

  factory FlightForecast.fromJson(Map<String, dynamic> j) => FlightForecast(
        pct: _i(j['pct']),
        riskScore: j['riskScore'] is num ? (j['riskScore'] as num).toDouble() : null,
        band: _s(j['band'], 'watch'),
        tone: toneFrom(_s(j['tone'], 'low')),
        connectionRisk: j['connectionRisk'] is num
            ? (j['connectionRisk'] as num).toDouble()
            : null,
        confidence: _d(j['confidence']),
        source: _s(j['source'], 'mock'),
        thresholds: Thresholds.fromJson(_m(j['thresholds'])),
      );
}

class Alt {
  final String id, code, dep, arr, cabin, currency, why;
  final int seats;
  final num fare;
  final int? expiresAt;
  final String? kind; // carrier-protected | market
  final bool? fitsParty;
  final num? partyFare;
  final bool ok;

  const Alt({
    required this.id,
    required this.code,
    required this.dep,
    required this.arr,
    required this.cabin,
    required this.seats,
    required this.fare,
    required this.currency,
    required this.expiresAt,
    required this.kind,
    required this.fitsParty,
    required this.partyFare,
    required this.ok,
    required this.why,
  });

  factory Alt.fromJson(Map<String, dynamic> j) => Alt(
        id: _s(j['id']),
        code: _s(j['code']),
        dep: _s(j['dep']),
        arr: _s(j['arr']),
        cabin: _s(j['cabin']),
        seats: _i(j['seats']),
        fare: _d(j['fare']),
        currency: _s(j['currency'], 'INR'),
        expiresAt: _inull(j['expiresAt']),
        kind: _sn(j['kind']),
        fitsParty: j['fitsParty'] is bool ? j['fitsParty'] as bool : null,
        partyFare: j['partyFare'] is num ? j['partyFare'] as num : null,
        ok: _b(j['ok']),
        why: _s(j['why']),
      );
}

class HotelOpt {
  final String id, name, area, checkin, currency, why, walk;
  final num rate, extra;
  final bool ok;
  const HotelOpt({
    required this.id,
    required this.name,
    required this.area,
    required this.checkin,
    required this.rate,
    required this.extra,
    required this.currency,
    required this.ok,
    required this.why,
    required this.walk,
  });

  factory HotelOpt.fromJson(Map<String, dynamic> j) => HotelOpt(
        id: _s(j['id']),
        name: _s(j['name']),
        area: _s(j['area']),
        checkin: _s(j['checkin']),
        rate: _d(j['rate']),
        extra: _d(j['extra']),
        currency: _s(j['currency'], 'INR'),
        ok: _b(j['ok']),
        why: _s(j['why']),
        walk: _s(j['walk']),
      );
}

class CabOpt {
  final String id, kind, currency, why;
  final int seats;
  final num extra;
  final bool ok;
  const CabOpt({
    required this.id,
    required this.kind,
    required this.seats,
    required this.extra,
    required this.currency,
    required this.ok,
    required this.why,
  });

  factory CabOpt.fromJson(Map<String, dynamic> j) => CabOpt(
        id: _s(j['id']),
        kind: _s(j['kind']),
        seats: _i(j['seats']),
        extra: _d(j['extra']),
        currency: _s(j['currency'], 'INR'),
        ok: _b(j['ok']),
        why: _s(j['why']),
      );
}

class CabLeg {
  final String id, from, to, pickup, note;
  const CabLeg({
    required this.id,
    required this.from,
    required this.to,
    required this.pickup,
    required this.note,
  });

  factory CabLeg.fromJson(Map<String, dynamic> j) => CabLeg(
        id: _s(j['id']),
        from: _s(j['from']),
        to: _s(j['to']),
        pickup: _s(j['pickup']),
        note: _s(j['note']),
      );
}

class PastFlight {
  final String id, code, from, to, dep, arr, dur, date, exact, outcome, detail;
  final String? recovered;
  const PastFlight({
    required this.id,
    required this.code,
    required this.from,
    required this.to,
    required this.dep,
    required this.arr,
    required this.dur,
    required this.date,
    required this.exact,
    required this.outcome,
    required this.detail,
    required this.recovered,
  });

  factory PastFlight.fromJson(Map<String, dynamic> j) => PastFlight(
        id: _s(j['id']),
        code: _s(j['code']),
        from: _s(j['from']),
        to: _s(j['to']),
        dep: _s(j['dep']),
        arr: _s(j['arr']),
        dur: _s(j['dur']),
        date: _s(j['date']),
        exact: _s(j['exact']),
        outcome: _s(j['outcome'], 'ontime'),
        detail: _s(j['detail']),
        recovered: _sn(j['recovered']),
      );
}

class Traveller {
  final String id, displayName, type, seat;
  const Traveller({
    required this.id,
    required this.displayName,
    required this.type,
    required this.seat,
  });
  factory Traveller.fromJson(Map<String, dynamic> j) => Traveller(
        id: _s(j['id']),
        displayName: _s(j['displayName']),
        type: _s(j['type']),
        seat: _s(j['seat']),
      );
}

/// Tickets, not PNRs — a single booking can cover a party.
class Booking {
  final String id, seat, pnr, cabin;
  final int? partySize;
  final List<Traveller> travellers;
  const Booking({
    required this.id,
    required this.seat,
    required this.pnr,
    required this.cabin,
    required this.partySize,
    required this.travellers,
  });

  factory Booking.fromJson(Map<String, dynamic> j) => Booking(
        id: _s(j['id']),
        seat: _s(j['seat']),
        pnr: _s(j['pnr']),
        cabin: _s(j['cabin']),
        partySize: _inull(j['partySize']),
        travellers: _list(j['travellers']).map(Traveller.fromJson).toList(),
      );
}

class FlightSummary {
  final String id, code, from, to, depISO;
  final int durationMin, passengerCount;
  final String? aircraft, terminal;
  final FlightForecast? forecast;
  final String disruptionPhase; // none | DECIDING | READY
  final Booking? booking;

  const FlightSummary({
    required this.id,
    required this.code,
    required this.from,
    required this.to,
    required this.depISO,
    required this.durationMin,
    required this.aircraft,
    required this.terminal,
    required this.forecast,
    required this.passengerCount,
    required this.disruptionPhase,
    required this.booking,
  });

  bool get disrupted => disruptionPhase != 'none';

  /// Falls back to now rather than throwing — a malformed date must not blank
  /// the whole schedule.
  DateTime get departure => DateTime.tryParse(depISO)?.toLocal() ?? DateTime.now();
  DateTime get arrival => departure.add(Duration(minutes: durationMin));

  factory FlightSummary.fromJson(Map<String, dynamic> j) => FlightSummary(
        id: _s(j['id']),
        code: _s(j['code']),
        from: _s(j['from']),
        to: _s(j['to']),
        depISO: _s(j['depISO']),
        durationMin: _i(j['durationMin']),
        aircraft: _sn(j['aircraft']),
        terminal: _sn(j['terminal']),
        forecast:
            j['forecast'] is Map ? FlightForecast.fromJson(_m(j['forecast'])) : null,
        passengerCount: _i(j['passengerCount'], 1),
        disruptionPhase: _s(j['disruptionPhase'], 'none'),
        booking: j['booking'] is Map ? Booking.fromJson(_m(j['booking'])) : null,
      );
}

class DetailBooking {
  final String id, passengerId, passengerName, seat, pnr;
  final int? partySize;
  const DetailBooking({
    required this.id,
    required this.passengerId,
    required this.passengerName,
    required this.seat,
    required this.pnr,
    required this.partySize,
  });
  factory DetailBooking.fromJson(Map<String, dynamic> j) => DetailBooking(
        id: _s(j['id']),
        passengerId: _s(j['passengerId']),
        passengerName: _s(j['passengerName']),
        seat: _s(j['seat']),
        pnr: _s(j['pnr']),
        partySize: _inull(j['partySize']),
      );
}

class FlightDetail {
  final FlightSummary summary;
  final List<Alt> alts;
  final List<HotelOpt> hotels;
  final List<CabOpt> cabs;
  final List<CabLeg> cabLegs;
  final List<DetailBooking> bookings;

  const FlightDetail({
    required this.summary,
    required this.alts,
    required this.hotels,
    required this.cabs,
    required this.cabLegs,
    required this.bookings,
  });

  factory FlightDetail.fromJson(Map<String, dynamic> j) {
    final c = _m(j['candidates']);
    return FlightDetail(
      summary: FlightSummary.fromJson(j),
      alts: _list(c['alts']).map(Alt.fromJson).toList(),
      hotels: _list(c['hotels']).map(HotelOpt.fromJson).toList(),
      cabs: _list(c['cabs']).map(CabOpt.fromJson).toList(),
      cabLegs: _list(c['cabLegs']).map(CabLeg.fromJson).toList(),
      bookings: _list(j['bookings']).map(DetailBooking.fromJson).toList(),
    );
  }
}

class Me {
  final String id, displayName, consent;
  const Me({required this.id, required this.displayName, required this.consent});
  factory Me.fromJson(Map<String, dynamic> j) => Me(
        id: _s(j['id']),
        displayName: _s(j['displayName']),
        consent: _s(j['consent'], 'ask'),
      );
}

class PassengerSchedule {
  final Me passenger;
  final List<FlightSummary> upcoming;
  final List<PastFlight> past;
  const PassengerSchedule({
    required this.passenger,
    required this.upcoming,
    required this.past,
  });

  factory PassengerSchedule.fromJson(Map<String, dynamic> j) => PassengerSchedule(
        passenger: Me.fromJson(_m(j['passenger'])),
        upcoming: _list(j['upcoming']).map(FlightSummary.fromJson).toList(),
        past: _list(j['past']).map(PastFlight.fromJson).toList(),
      );
}

class Loyalty {
  final String airline, number, tier;
  const Loyalty({required this.airline, required this.number, required this.tier});
  factory Loyalty.fromJson(Map<String, dynamic> j) => Loyalty(
        airline: _s(j['airline']),
        number: _s(j['number']),
        tier: _s(j['tier'], '—'),
      );
}

class Pref {
  final String k, v;
  const Pref({required this.k, required this.v});
  factory Pref.fromJson(Map<String, dynamic> j) =>
      Pref(k: _s(j['k']), v: _s(j['v']));
}

class Passenger {
  final String id, displayName, legalName, dob, gender, nationality, consent;
  final String passportNumber, passportExpiry, passportIssued;
  final String email, phone, card, method;
  final List<Loyalty> loyalty;
  final List<Pref> prefs;

  const Passenger({
    required this.id,
    required this.displayName,
    required this.legalName,
    required this.dob,
    required this.gender,
    required this.nationality,
    required this.consent,
    required this.passportNumber,
    required this.passportExpiry,
    required this.passportIssued,
    required this.email,
    required this.phone,
    required this.card,
    required this.method,
    required this.loyalty,
    required this.prefs,
  });

  factory Passenger.fromJson(Map<String, dynamic> j) {
    final passport = _m(j['passport']);
    final contact = _m(j['contact']);
    final payment = _m(j['payment']);
    return Passenger(
      id: _s(j['id']),
      displayName: _s(j['displayName']),
      legalName: _s(j['legalName']),
      dob: _s(j['dob']),
      gender: _s(j['gender']),
      nationality: _s(j['nationality']),
      consent: _s(j['consent'], 'ask'),
      passportNumber: _s(passport['number']),
      passportExpiry: _s(passport['expiry']),
      passportIssued: _s(passport['issued']),
      email: _s(contact['email']),
      phone: _s(contact['phone']),
      card: _s(payment['card']),
      method: _s(payment['method']),
      loyalty: _list(j['loyalty']).map(Loyalty.fromJson).toList(),
      prefs: _list(j['prefs']).map(Pref.fromJson).toList(),
    );
  }
}

class PreAuth {
  final String flightId, passengerId, altId, hotelId, cabId;
  final num owed;
  final int grantedAt;
  const PreAuth({
    required this.flightId,
    required this.passengerId,
    required this.altId,
    required this.hotelId,
    required this.cabId,
    required this.owed,
    required this.grantedAt,
  });
  factory PreAuth.fromJson(Map<String, dynamic> j) => PreAuth(
        flightId: _s(j['flightId']),
        passengerId: _s(j['passengerId']),
        altId: _s(j['altId']),
        hotelId: _s(j['hotelId']),
        cabId: _s(j['cabId']),
        owed: _d(j['owed']),
        grantedAt: _i(j['grantedAt']),
      );
}

class Step {
  final String n, s;
  final double d;
  final String? live;
  const Step({required this.n, required this.d, required this.s, this.live});
  factory Step.fromJson(Map<String, dynamic> j) => Step(
        n: _s(j['n']),
        d: _d(j['d']),
        s: _s(j['s']),
        live: _sn(j['live']),
      );
}

class Resolution {
  final String kind; // autopilot | approved | handed-over
  final int at;
  const Resolution({required this.kind, required this.at});
  factory Resolution.fromJson(Map<String, dynamic> j) =>
      Resolution(kind: _s(j['kind']), at: _i(j['at']));
}

/// Everything on this object is computed server-side, including `phase`,
/// `shown` and `secondsLeft`. The client renders it and never advances it.
class RecoveryView {
  final String? taskId;
  final String flightId;
  final int detectedAt;
  final String phase; // deciding | waiting | choosing | acting | booked | handed
  final List<Step> shown;
  final int secondsLeft, windowSeconds;
  final String windowBoundBy;
  final String chosenAltId, chosenHotelId, chosenCabId;
  final List<String> rejectedAltIds;
  final num owedNow;
  final String? note;
  final Resolution? resolution;

  const RecoveryView({
    required this.taskId,
    required this.flightId,
    required this.detectedAt,
    required this.phase,
    required this.shown,
    required this.secondsLeft,
    required this.windowSeconds,
    required this.windowBoundBy,
    required this.chosenAltId,
    required this.chosenHotelId,
    required this.chosenCabId,
    required this.rejectedAltIds,
    required this.owedNow,
    required this.note,
    required this.resolution,
  });

  factory RecoveryView.fromJson(Map<String, dynamic> j) => RecoveryView(
        taskId: _sn(j['taskId']),
        flightId: _s(j['flightId']),
        detectedAt: _i(j['detectedAt']),
        phase: _s(j['phase'], 'deciding'),
        shown: _list(j['shown']).map(Step.fromJson).toList(),
        secondsLeft: _i(j['secondsLeft']),
        windowSeconds: _i(j['windowSeconds']),
        windowBoundBy: _s(j['windowBoundBy'], 'ceiling'),
        chosenAltId: _s(j['chosenAltId']),
        chosenHotelId: _s(j['chosenHotelId']),
        chosenCabId: _s(j['chosenCabId']),
        rejectedAltIds: j['rejectedAltIds'] is List
            ? (j['rejectedAltIds'] as List).whereType<String>().toList()
            : const <String>[],
        owedNow: _d(j['owedNow']),
        note: _sn(j['note']),
        resolution:
            j['resolution'] is Map ? Resolution.fromJson(_m(j['resolution'])) : null,
      );
}
