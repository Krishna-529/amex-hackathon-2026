import 'api/models.dart';

/// Copy in the phone of what the web app shows for the warm path, ported from
/// zkd-android/src/lib/recovery.ts.
///
/// This is a FIXTURE, not fetched. It describes the work that ran BEFORE the
/// cancellation — hours earlier, off the critical path — which is the only
/// reason the live half takes seconds. The server's own `shown` steps are
/// rendered underneath it.
///
/// Latency comes from the spec's budget: 42s of warm work (ingest 3 + assembly 5
/// + supplier fan-out 34), leaving ~11s at the carrier event.
const List<Step> warmSteps = [
  Step(
    n: 'Signal picked up',
    d: 3,
    s: 'Delay-to-departure ratio crossed threshold on this flight. '
        'Duplicate feeds deduped at the edge.',
  ),
  Step(
    n: 'Your trip assembled',
    d: 5,
    s: 'PNR, trip graph, benefit entitlement and travel window pulled together. '
        "Any onward leg and tonight's hotel, if either applies, hang off this flight.",
  ),
  Step(
    n: 'Suppliers searched',
    d: 34,
    s: 'One coordinator reshop covering everyone on this flight, not one per '
        'passenger — 300 calls collapse to 102. Candidates priced and held warm: '
        'no booking, no spend, nothing you could be charged for.',
  ),
];

double _sum(List<Step> xs) => xs.fold(0.0, (a, s) => a + s.d);

/// Summed from the steps, never asserted separately.
final double warmTotal = _sum(warmSteps); // 42
const double decideTotal = 1.01; // 0.4 + 0.6 + 0.01
const double actTotal = 10.4; // 0.9 + 3.4 + 2.6 + 1.5 + 1.1 + 0.6 + 0.3
const double machineTotal = decideTotal + actTotal;

/// Risk bands, from zkd-android/src/lib/forecast.ts.
const Map<String, String> bandLabel = {
  'watch': 'Low risk',
  'prepare': 'Moderate risk',
  'hold-gate': 'High risk',
  'pre-authorise': 'Very high risk',
};

const Map<String, String> bandSay = {
  'watch': "Nothing unusual around this flight. We'll keep watching it and only "
      'tell you if that changes.',
  'prepare': 'A few things are working against this one. We’re already '
      'lining up alternatives in the background.',
  'hold-gate': "This flight is in real trouble. We've got backup seats "
      "identified and we'll move you the moment it's called.",
  'pre-authorise': "This one looks likely to go. Tell us now what you'd want "
      "and we won't need to ask you in a hurry later.",
};

const String noForecastYet =
    'Checking this flight against the disruption forecast.';

/// Seeded demo logins, duplicated from zkd-app/lib/demoAccounts.ts. A prototype
/// fixture, not how a real card member would authenticate.
const List<({String email, String password, String name})> demoAccounts = [
  (email: 'priya@zkd.demo', password: 'priya-2026', name: 'Priya S.'),
  (email: 'arjun@zkd.demo', password: 'arjun-2026', name: 'Arjun M.'),
  (email: 'fatima@zkd.demo', password: 'fatima-2026', name: 'Fatima S.'),
  (email: 'rohan@zkd.demo', password: 'rohan-2026', name: 'Rohan V.'),
  (email: 'ananya@zkd.demo', password: 'ananya-2026', name: 'Ananya I.'),
];

const Map<String, String> outcomeLabel = {
  'ontime': 'On time',
  'delayed': 'Delayed',
  'cancelled': 'Cancelled',
};
