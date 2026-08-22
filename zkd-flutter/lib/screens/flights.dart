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
import 'flight_detail.dart';
import 'profile.dart';
import 'recovery.dart';

/// Home. Everything here comes from the 4s schedule poll in World, plus two
/// screen-local polls for the banner at the top.
class FlightsScreen extends StatefulWidget {
  const FlightsScreen({super.key});
  static const route = '/flights';

  @override
  State<FlightsScreen> createState() => _FlightsScreenState();
}

class _FlightsScreenState extends State<FlightsScreen> {
  bool _allHistory = false;

  @override
  Widget build(BuildContext context) {
    final world = context.watch<World>();
    final schedule = world.schedule;

    return Scaffold(
      appBar: AppBar(
        title: const Text('ZKD Concierge'),
        actions: [ProfileAvatarButton(name: world.displayName)],
      ),
      // No spinner and no message while the first poll is in flight — same as
      // the original, which showed only the heading.
      body: schedule == null || schedule.upcoming.isEmpty
          ? const PageBody(children: [PageHead('Your flights')])
          : _body(context, schedule),
    );
  }

  Widget _body(BuildContext context, PassengerSchedule schedule) {
    final scheme = Theme.of(context).colorScheme;
    final now = DateTime.now();
    final upcoming = schedule.upcoming;
    final past = schedule.past;
    final next = upcoming.first;
    final autopilot = schedule.passenger.consent == 'autopilot';
    final rows = _allHistory ? past : past.take(4).toList();

    return PageBody(
      children: [
        PageHead(
          'Your flights',
          lede: Text.rich(TextSpan(
            style: Theme.of(context)
                .textTheme
                .bodyMedium
                ?.copyWith(color: scheme.onSurfaceVariant, height: 1.5),
            children: [
              TextSpan(
                text: 'We watch every booking and act the moment something '
                    'breaks — ${autopilot ? 'without waking you' : 'then wait for your go-ahead'}. ',
              ),
              WidgetSpan(
                alignment: PlaceholderAlignment.baseline,
                baseline: TextBaseline.alphabetic,
                child: GestureDetector(
                  onTap: () =>
                      Navigator.of(context).pushNamed(ProfileScreen.route),
                  child: Text(
                    autopilot ? 'Autopilot' : 'Ask me first',
                    style: TextStyle(color: scheme.primary, height: 1.5),
                  ),
                ),
              ),
              const TextSpan(
                text: ' is the permission you set when you activated your card.',
              ),
            ],
          )),
        ),

        // The pre-cancellation nudge: the flight has NOT been cancelled, but the
        // forecast has crossed the threshold where asking early is worth it.
        if (!next.disrupted &&
            next.forecast != null &&
            next.forecast!.pct >= next.forecast!.thresholds.preAuthorise)
          Poll<PreAuth>(
            pollKey: 'preauth-${next.id}',
            interval: const Duration(milliseconds: 6000),
            fetch: () => Api.instance.fetchPreAuth(next.id),
            builder: (context, preAuth) => _AlertBanner(
              tone: Tones.risk,
              glyph: '!',
              title: preAuth != null
                  ? "You've told us what to do if ${next.code} cancels"
                  : '${next.code} looks like it will cancel — ${next.forecast!.pct}%',
              body: preAuth != null
                  ? 'We act the second it happens. No decision window needed at all.'
                  : "It hasn't been cancelled. Tell us now what you'd want, "
                      'while you have time to think.',
              action: preAuth != null ? 'Review →' : 'Decide →',
              onTap: () => Navigator.of(context)
                  .pushNamed(FlightDetailScreen.route, arguments: next.id),
            ),
          ),

        // The disruption banner, once something has actually broken.
        if (next.disrupted)
          Poll<RecoveryView>(
            pollKey: 'recovery-${next.id}',
            interval: const Duration(milliseconds: 2000),
            fetch: () => Api.instance.fetchRecovery(next.id),
            builder: (context, view) {
              final booked = view?.phase == 'booked';
              final handed = view?.phase == 'handed';
              final tone = booked ? Tones.safe : Tones.risk;
              final detected = view == null
                  ? null
                  : DateTime.fromMillisecondsSinceEpoch(view.detectedAt);
              return _AlertBanner(
                tone: tone,
                glyph: booked ? '✓' : '!',
                title: booked
                    ? 'Rebooked. Your trip is back together.'
                    : handed
                        ? 'A person has taken over your trip'
                        : '${next.code} has been cancelled',
                body: booked
                    ? 'Alternative booked · hotel moved · you paid nothing'
                    : handed
                        ? 'Nothing was booked and nothing was charged.'
                        : '${detected == null ? '' : 'Detected ${agoLabel(detected, now)}. '}'
                            '${autopilot ? "We're rebooking you now — tap to watch." : 'We need your go-ahead before we book anything.'}',
                action: view?.resolution == null ? 'Open →' : 'View →',
                onTap: () => Navigator.of(context)
                    .pushNamed(RecoveryScreen.route, arguments: next.id),
              );
            },
          ),

        const SectionHeader('Upcoming'),
        Card(
          child: Column(
            children: [
              for (var i = 0; i < upcoming.length; i++)
                _UpcomingRow(flight: upcoming[i], isNext: i == 0, first: i == 0),
            ],
          ),
        ),

        if (past.isNotEmpty) ...[
          const SectionHeader('Recent history'),
          Card(
            child: Column(
              children: [
                for (var i = 0; i < rows.length; i++)
                  _PastRow(flight: rows[i], first: i == 0),
              ],
            ),
          ),
          Center(
            child: TextButton(
              onPressed: () => setState(() => _allHistory = !_allHistory),
              child: Text(_allHistory
                  ? 'Show fewer'
                  : 'See all ${past.length} flights →'),
            ),
          ),
        ],

        Padding(
          padding: const EdgeInsets.only(top: 20),
          child: Text(
            'ZKD Concierge watches every booking, detects a disruption the '
            'moment the airline files it, and rebooks your flight, hotel and '
            'ground legs inside your policy — then tells you what it did.',
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: scheme.onSurfaceVariant, height: 1.6),
          ),
        ),
      ],
    );
  }
}

/// Round avatar in the app bar; goes to the member's own details.
class ProfileAvatarButton extends StatelessWidget {
  const ProfileAvatarButton({super.key, required this.name});
  final String? name;

  String get _initials {
    final parts = (name ?? '').trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '··';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts.first.substring(0, 1) + parts.last.substring(0, 1))
        .toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(right: 12),
      child: Tooltip(
        message: 'Your details',
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: () => Navigator.of(context).pushNamed(ProfileScreen.route),
          child: CircleAvatar(
            radius: 16,
            backgroundColor: scheme.primary,
            child: Text(
              _initials,
              style: TextStyle(
                color: scheme.onPrimary,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _AlertBanner extends StatelessWidget {
  const _AlertBanner({
    required this.tone,
    required this.glyph,
    required this.title,
    required this.body,
    required this.action,
    required this.onTap,
  });

  final Color tone;
  final String glyph, title, body, action;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Card(
        color: toneSoft(tone),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: toneEdge(tone)),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 36,
                  height: 36,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: toneSoft(tone),
                    border: Border.all(color: toneEdge(tone)),
                    borderRadius: BorderRadius.circular(11),
                  ),
                  child: Text(glyph,
                      style: TextStyle(color: tone, fontSize: 17)),
                ),
                const SizedBox(width: 13),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title,
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                      const SizedBox(height: 3),
                      Text(body,
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(height: 1.4)),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Text(action, style: TextStyle(color: tone, fontSize: 12)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _UpcomingRow extends StatelessWidget {
  const _UpcomingRow({
    required this.flight,
    required this.isNext,
    required this.first,
  });

  final FlightSummary flight;
  final bool isNext, first;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final now = DateTime.now();
    final cancelled = flight.disrupted;
    final fc = flight.forecast;

    return InkWell(
      onTap: () => Navigator.of(context).pushNamed(
        cancelled ? RecoveryScreen.route : FlightDetailScreen.route,
        arguments: flight.id,
      ),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: first
            ? null
            : BoxDecoration(
                border: Border(
                    top: BorderSide(
                        color: scheme.outlineVariant.withValues(alpha: 0.35)))),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(flight.code,
                          style: text.bodySmall
                              ?.copyWith(color: scheme.onSurfaceVariant)),
                      const SizedBox(width: 8),
                      if (cancelled)
                        const TonePill('Cancelled', color: Tones.risk)
                      else if (isNext)
                        TonePill('Next', color: scheme.primary),
                      const Spacer(),
                      Text(dayLabel(flight.departure, now),
                          style: text.bodySmall
                              ?.copyWith(color: scheme.onSurfaceVariant)),
                    ],
                  ),
                  const SizedBox(height: 12),
                  RouteLine(
                    from: flight.from,
                    to: flight.to,
                    dep: hhmm(flight.departure),
                    arr: hhmm(flight.arrival),
                    dur: durLabel(flight.durationMin),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    cancelled
                        ? 'Cancelled — tap to see the recovery.'
                        : (fc == null
                            ? noForecastYet
                            : (bandSay[fc.band] ?? noForecastYet)),
                    style: text.bodySmall
                        ?.copyWith(color: scheme.onSurfaceVariant, height: 1.4),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            SizedBox(
              width: 88,
              child: Column(
                children: [
                  // riskScore, written "72/100", is what the web app shows.
                  // `pct` is a different quantity (the actual probability), and
                  // showing one on the phone and the other on the laptop makes
                  // the same flight look like two flights.
                  if (cancelled)
                    Text('✕',
                        style: text.headlineMedium
                            ?.copyWith(fontWeight: FontWeight.w700, color: Tones.risk))
                  else if (fc == null)
                    Text('—',
                        style: text.headlineMedium?.copyWith(
                            fontWeight: FontWeight.w700,
                            color: scheme.onSurfaceVariant))
                  else
                    Text.rich(
                      TextSpan(children: [
                        TextSpan(
                          text: '${(fc.riskScore ?? fc.pct.toDouble()).round()}',
                          style: text.headlineMedium?.copyWith(
                            fontWeight: FontWeight.w700,
                            color: colorForTone(fc.tone),
                          ),
                        ),
                        TextSpan(
                          text: '/100',
                          style: text.labelSmall
                              ?.copyWith(color: scheme.onSurfaceVariant),
                        ),
                      ]),
                    ),
                  const SizedBox(height: 4),
                  Text(
                    cancelled ? 'cancelled' : 'risk score',
                    style: text.labelSmall
                        ?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                  const SizedBox(height: 10),
                  Text(cancelled ? 'Recovery →' : 'Details →',
                      style: text.labelSmall),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PastRow extends StatelessWidget {
  const _PastRow({required this.flight, required this.first});
  final PastFlight flight;
  final bool first;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final tone = switch (flight.outcome) {
      'cancelled' => Tones.risk,
      'delayed' => Tones.warn,
      _ => scheme.onSurfaceVariant,
    };

    return InkWell(
      onTap: () => Navigator.of(context)
          .pushNamed(FlightDetailScreen.route, arguments: flight.id),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 12),
        decoration: first
            ? null
            : BoxDecoration(
                border: Border(
                    top: BorderSide(
                        color: scheme.outlineVariant.withValues(alpha: 0.35)))),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text.rich(TextSpan(children: [
                    TextSpan(
                        text: flight.code,
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                    TextSpan(
                      text: '  ${flight.from} → ${flight.to}',
                      style: TextStyle(color: scheme.onSurfaceVariant),
                    ),
                  ])),
                  const SizedBox(height: 5),
                  Text(
                    '${flight.date} · ${flight.exact} · ${flight.dep}',
                    style: text.bodySmall
                        ?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            TonePill(outcomeLabel[flight.outcome] ?? flight.outcome, color: tone),
          ],
        ),
      ),
    );
  }
}
