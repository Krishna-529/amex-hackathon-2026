import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../fixtures.dart';
import '../state/poller.dart';
import '../state/world.dart';
import '../theme.dart';
import '../util/time.dart';
import '../widgets/common.dart';
import 'flights.dart';
import 'recovery.dart';

/// One flight, upcoming or past. Nothing on this screen POSTs — the only action
/// is a jump to the recovery when the flight has already been cancelled.
class FlightDetailScreen extends StatelessWidget {
  const FlightDetailScreen({super.key, required this.flightId});
  static const route = '/flight';
  final String flightId;

  @override
  Widget build(BuildContext context) {
    final world = context.watch<World>();
    final schedule = world.schedule;

    Widget scaffold(Widget body) => Scaffold(
          appBar: AppBar(actions: [ProfileAvatarButton(name: world.displayName)]),
          body: body,
        );

    if (schedule == null) {
      return scaffold(const PageBody(children: [PageHead('Loading your flight')]));
    }

    final upcoming =
        schedule.upcoming.where((f) => f.id == flightId).firstOrNull;
    final past = schedule.past.where((f) => f.id == flightId).firstOrNull;

    if (upcoming == null && past == null) {
      return scaffold(const PageBody(children: [PageHead('Flight not found')]));
    }

    if (upcoming == null) {
      return scaffold(_pastBody(context, past!, schedule));
    }

    // Only upcoming flights poll: a past one can never change.
    return scaffold(
      Poll<FlightDetail>(
        pollKey: 'detail-$flightId',
        interval: const Duration(milliseconds: 5000),
        fetch: () => Api.instance.fetchFlightDetail(flightId),
        builder: (context, detail) =>
            _upcomingBody(context, upcoming, detail, schedule),
      ),
    );
  }

  // ── past ────────────────────────────────────────────────────────────────

  Widget _pastBody(
      BuildContext context, PastFlight f, PassengerSchedule schedule) {
    final record = _routeRecord(schedule.past, f.from, f.to);
    final tone = switch (f.outcome) {
      'cancelled' => Tones.risk,
      'delayed' => Tones.warn,
      _ => Tones.safe,
    };

    return PageBody(
      children: [
        PageHead(
          '${f.code} · ${f.from} → ${f.to}',
          lede: Text('${f.date} · ${f.dep} – ${f.arr}'),
        ),
        PanelCard(children: [
          RouteLine(
              from: f.from, to: f.to, dep: f.dep, arr: f.arr, dur: f.dur),
        ]),
        const SizedBox(height: 14),
        PanelCard(title: 'What happened', children: [
          KV('Outcome', outcomeLabel[f.outcome] ?? f.outcome,
              tone: tone, first: true),
          KV('Detail', f.detail),
          KV("You've flown ${f.from}→${f.to}",
              '${record.flown}× · ${record.cancelled} cancelled'),
        ]),
        const SizedBox(height: 14),
        if (f.recovered != null)
          PanelCard(
            title: 'What we did',
            titleColor: Theme.of(context).colorScheme.primary,
            children: [Text(f.recovered!, style: const TextStyle(height: 1.6))],
          )
        else
          const PanelCard(
            title: 'Notes',
            children: [Text('Nothing needed doing on this one.')],
          ),
      ],
    );
  }

  // ── upcoming ────────────────────────────────────────────────────────────

  Widget _upcomingBody(
    BuildContext context,
    FlightSummary f,
    FlightDetail? detail,
    PassengerSchedule schedule,
  ) {
    final scheme = Theme.of(context).colorScheme;
    final now = DateTime.now();
    final record = _routeRecord(schedule.past, f.from, f.to);

    final head = <Widget>[
      PageHead(
        '${f.code} · ${f.from} → ${f.to}',
        lede: Text(
          '${dayLabel(f.departure, now)}'
          '${f.aircraft != null ? ' · ${f.aircraft}' : ''} · ${flightWindow(f)}',
        ),
      ),
      PanelCard(children: [
        RouteLine(
          from: f.from,
          to: f.to,
          dep: hhmm(f.departure),
          arr: hhmm(f.arrival),
          dur: durLabel(f.durationMin),
        ),
      ]),
      const SizedBox(height: 14),
    ];

    if (f.disrupted) {
      return PageBody(children: [
        ...head,
        PanelCard(title: 'This flight was cancelled', children: [
          const Text("We've already rebuilt your trip around it."),
          const SizedBox(height: 14),
          FilledButton(
            // replace, not push: going back should skip this screen.
            onPressed: () => Navigator.of(context)
                .pushReplacementNamed(RecoveryScreen.route, arguments: f.id),
            child: const Text('View the recovery →'),
          ),
        ]),
      ]);
    }

    if (detail == null) {
      return PageBody(
          children: [...head, const PageHead('Loading risk detail…')]);
    }

    final fc = f.forecast;
    final usableAlts = detail.alts.where((a) => a.ok).toList();

    return PageBody(children: [
      ...head,

      // The number, big. It is bought from a vendor, not computed here.
      PanelCard(
        padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 20),
        children: [
          SizedBox(
            width: double.infinity,
            child: Column(
              children: [
                Text.rich(
                  TextSpan(children: [
                    TextSpan(
                      text: fc == null
                          ? '—'
                          : '${(fc.riskScore ?? fc.pct.toDouble()).round()}',
                      style: TextStyle(
                        fontSize: 62,
                        height: 1.05,
                        fontWeight: FontWeight.w700,
                        color: fc == null
                            ? scheme.onSurfaceVariant
                            : colorForTone(fc.tone),
                      ),
                    ),
                    if (fc != null)
                      TextSpan(
                        text: '/100',
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w600,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                  ]),
                ),
                const SizedBox(height: 6),
                Text('RISK SCORE',
                    style: Theme.of(context)
                        .textTheme
                        .labelSmall
                        ?.copyWith(letterSpacing: 1.8)),
                if (fc != null) ...[
                  const SizedBox(height: 18),
                  Text(
                    (bandLabel[fc.band] ?? '').toUpperCase(),
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                          letterSpacing: 1.8,
                          color: colorForTone(fc.tone),
                        ),
                  ),
                ],
                const SizedBox(height: 11),
                Text(
                  fc == null ? noForecastYet : (bandSay[fc.band] ?? noForecastYet),
                  textAlign: TextAlign.center,
                  style: const TextStyle(height: 1.55),
                ),
              ],
            ),
          ),
        ],
      ),
      const SizedBox(height: 14),

      if (fc != null) ...[
        PanelCard(title: 'Where this number comes from', children: [
          // Spelling both out, because they are NOT the same number: the score
          // is a percentile rank, the probability is the actual chance.
          KV('Cancel probability', '${fc.pct}%', first: true),
          KV('Risk score (percentile)',
              '${(fc.riskScore ?? fc.pct.toDouble()).round()}/100'),
          KV(
            'Forecast source',
            fc.source == 'lumo' ? 'Lumo — live' : fc.source,
          ),
          KV('Confidence', '${(fc.confidence * 100).round()}%'),
          KV('We ask you in advance at', '${fc.thresholds.preAuthorise}%'),
          KV('Seats left across every source',
              '${fc.thresholds.seatsAvailable}'),
          const Why(
            'We buy this forecast rather than building one, and that threshold '
            'moves with how many seats are left and how close departure is. '
            'Until it has been checked against what actually happened, it '
            'decides when we start preparing — never whether we spend your money.',
          ),
        ]),
        const SizedBox(height: 14),
      ],

      PanelCard(title: 'Your booking', children: [
        KV('Terminal', f.terminal ?? '—', first: true),
        KV('Seat', f.booking?.seat ?? '—'),
        KV('Reference', f.booking?.pnr ?? '—'),
        KV("You've flown this route",
            '${record.flown}× · ${record.cancelled} cancelled'),
      ]),
      const SizedBox(height: 14),

      PanelCard(title: 'If this one goes', children: [
        Text(
          "We're already holding ${usableAlts.length} alternatives that fit "
          'your policy and protect your onward connection.',
          style: const TextStyle(height: 1.5),
        ),
        const SizedBox(height: 12),
        for (var i = 0; i < usableAlts.length; i++)
          KV(
            '${usableAlts[i].code} · ${usableAlts[i].dep}',
            usableAlts[i].fare != 0
                ? money(usableAlts[i].fare)
                : 'no cost to you',
            tone: usableAlts[i].fare != 0 ? null : Tones.safe,
            first: i == 0,
          ),
      ]),
    ]);
  }
}

({int flown, int cancelled}) _routeRecord(
    List<PastFlight> past, String from, String to) {
  var flown = 0, cancelled = 0;
  for (final p in past) {
    if (p.from == from && p.to == to) {
      flown++;
      if (p.outcome == 'cancelled') cancelled++;
    }
  }
  return (flown: flown, cancelled: cancelled);
}
