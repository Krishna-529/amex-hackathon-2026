import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../state/poller.dart';
import '../state/world.dart';
import '../theme.dart';
import '../util/time.dart';
import '../widgets/common.dart';
import 'recovery.dart';

/// Everything held about the member, and why each field is needed. The consent
/// control lives here too — it is the permission the whole product runs on.
class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});
  static const route = '/profile';

  @override
  Widget build(BuildContext context) {
    final world = context.watch<World>();
    final id = world.passengerId;

    return Scaffold(
      appBar: AppBar(title: const Text('Your details')),
      body: Poll<Passenger>(
        pollKey: id == null ? null : 'passenger-$id',
        interval: const Duration(milliseconds: 8000),
        fetch: () => Api.instance.fetchPassenger(id!),
        builder: (context, p) {
          if (p == null || world.schedule == null) {
            return const PageBody(children: [PageHead('Your details')]);
          }
          return _body(context, p, world);
        },
      ),
    );
  }

  Widget _body(BuildContext context, Passenger p, World world) {
    final scheme = Theme.of(context).colorScheme;
    final schedule = world.schedule!;

    return PageBody(children: [
      const PageHead(
        'Your details',
        lede: Text(
          'Everything we hold about you, and why we need it. An airline will '
          'not issue a ticket in your name without these, so this is the whole '
          'list — nothing is kept that a booking does not require.',
        ),
      ),

      PanelCard(title: 'Who the ticket is issued to', children: [
        KV('Name, exactly as on your passport', p.legalName, first: true),
        KV('Date of birth', p.dob),
        KV('Gender', p.gender),
        KV('Nationality', p.nationality),
        const Why(
          'Airlines match these three against your travel document at '
          'check-in. A mismatch is the most common reason an automatic '
          'rebooking is rejected, so we store them exactly as printed.',
        ),
      ]),
      const SizedBox(height: 14),

      PanelCard(title: 'Travel document', children: [
        KV('Passport', p.passportNumber, first: true),
        KV('Expires', p.passportExpiry),
        KV('Issued by', p.passportIssued),
        const Why(
          'Needed for the international leg only. We show you the last two '
          'digits so you can confirm it is the right document without us '
          'displaying the number back to anyone.',
        ),
      ]),
      const SizedBox(height: 14),

      PanelCard(title: 'How the airline reaches you', children: [
        KV('Email', p.email, first: true),
        KV('Mobile', p.phone),
        const Why(
          'These go on the booking itself. It is how the carrier sends your '
          'boarding pass — and how we reach you inside the window before we act.',
        ),
      ]),
      const SizedBox(height: 14),

      if (p.loyalty.isNotEmpty) ...[
        PanelCard(title: 'Frequent flyer', children: [
          for (var i = 0; i < p.loyalty.length; i++)
            KV(
              p.loyalty[i].airline,
              p.loyalty[i].tier != '—'
                  ? '${p.loyalty[i].number} · ${p.loyalty[i].tier}'
                  : p.loyalty[i].number,
              first: i == 0,
            ),
          const Why(
            'Attached to every rebooking so a disruption never costs you '
            'status miles.',
          ),
        ]),
        const SizedBox(height: 14),
      ],

      const SectionHeader('Your bookings'),
      PanelCard(children: [
        for (var i = 0; i < schedule.upcoming.length; i++)
          _BookingRow(flight: schedule.upcoming[i], first: i == 0),
      ]),
      const SizedBox(height: 14),

      PanelCard(title: 'How you like to fly', children: [
        for (var i = 0; i < p.prefs.length; i++)
          KV(p.prefs[i].k, p.prefs[i].v, first: i == 0),
        const SizedBox(height: 16),
        Text(
          'WHEN A FLIGHT BREAKS',
          style: Theme.of(context)
              .textTheme
              .labelSmall
              ?.copyWith(letterSpacing: 1.5, color: scheme.onSurfaceVariant),
        ),
        const SizedBox(height: 9),
        // No optimistic update on purpose: the selection reflects the polled
        // value, so it only moves once the server confirms what took.
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'autopilot', label: Text('Autopilot')),
            ButtonSegment(value: 'ask', label: Text('Ask me first')),
          ],
          selected: {p.consent},
          onSelectionChanged: (s) => world.setConsent(s.first),
        ),
        Why(
          p.consent == 'autopilot'
              ? 'We rebook inside your policy without waking you. You still '
                  'get a window to stop us before anything is paid for.'
              : 'We do all the work then stop and wait for your go-ahead. If '
                  'you do not answer, we hold rather than book.',
        ),
      ]),
      const SizedBox(height: 14),

      PanelCard(title: 'Payment', children: [
        KV('Card on file', p.card, first: true),
        KV('How we charge', p.method),
        const Why(
          'Each booking gets its own single-use card number, locked to that '
          'amount and that date. It cannot be reused, so nothing here can be '
          'charged twice.',
        ),
      ]),
      const SizedBox(height: 14),

      PanelCard(
        title: 'What we never hold',
        titleColor: Tones.safe,
        children: const [
          KV('We never store your CVV or full card number', '✓',
              tone: Tones.safe, first: true),
          KV('We never share your passport with anyone but the operating airline',
              '✓',
              tone: Tones.safe),
          KV('We never hold payment credentials the agent can reuse', '✓',
              tone: Tones.safe),
        ],
      ),
      const SizedBox(height: 18),

      OutlinedButton(
        onPressed: () => world.signOut(),
        child: const Text('Sign out'),
      ),
    ]);
  }
}

class _BookingRow extends StatelessWidget {
  const _BookingRow({required this.flight, required this.first});
  final FlightSummary flight;
  final bool first;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final party = flight.booking?.partySize ?? 1;

    return Container(
      padding: EdgeInsets.only(top: first ? 0 : 12, bottom: 12),
      decoration: first
          ? null
          : BoxDecoration(
              border: Border(top: BorderSide(color: Amex.line2))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              SizedBox(
                width: 56,
                child: Text(flight.code,
                    style: text.bodySmall
                        ?.copyWith(color: scheme.onSurfaceVariant)),
              ),
              Expanded(child: Text('${flight.from} → ${flight.to}')),
              if (flight.booking != null)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: scheme.primary.withValues(alpha: 0.10),
                    border:
                        Border.all(color: scheme.primary.withValues(alpha: 0.3)),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(flight.booking!.pnr,
                      style: TextStyle(color: scheme.primary, fontSize: 12)),
                ),
            ],
          ),
          const SizedBox(height: 6),
          if (flight.disrupted)
            InkWell(
              onTap: () => Navigator.of(context)
                  .pushNamed(RecoveryScreen.route, arguments: flight.id),
              child: Text(
                'Disrupted — view recovery →',
                style: TextStyle(color: scheme.primary, fontSize: 12),
              ),
            )
          else
            Text(
              party > 1
                  ? '${hhmm(flight.departure)} · $party travellers · ${flight.terminal ?? ''}'
                  : '${hhmm(flight.departure)} · seat ${flight.booking?.seat ?? '—'} · ${flight.terminal ?? ''}',
              style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
            ),
        ],
      ),
    );
  }
}
