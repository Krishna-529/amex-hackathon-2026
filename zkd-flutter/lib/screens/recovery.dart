import 'package:flutter/material.dart' hide Step;
import 'package:provider/provider.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../fixtures.dart';
import '../notify.dart';
import '../state/poller.dart';
import '../state/world.dart';
import '../theme.dart';
import '../util/time.dart';
import '../widgets/common.dart';
import 'flights.dart';

/// The centrepiece — and a PURE RENDERER of server state.
///
/// `phase`, `shown`, `secondsLeft` and `windowSeconds` are all computed by
/// zkd-app/server/engine/simulation.ts. There is no local phase machine and no
/// local countdown tween: the counter and the progress bar step discretely at
/// the 1.5s poll cadence, which is deliberate. Inventing a client-side timer
/// here would let the phone disagree with the server about how long the member
/// has left, which is the one number that must never be wrong.
class RecoveryScreen extends StatelessWidget {
  const RecoveryScreen({super.key, required this.flightId});
  static const route = '/recovery';
  final String flightId;

  @override
  Widget build(BuildContext context) {
    final world = context.watch<World>();

    return Scaffold(
      appBar: AppBar(actions: [ProfileAvatarButton(name: world.displayName)]),
      body: Poll<RecoveryView>(
        pollKey: 'view-$flightId',
        interval: const Duration(milliseconds: 1500),
        fetch: () => Api.instance.fetchRecovery(flightId),
        builder: (context, view) => Poll<FlightDetail>(
          pollKey: 'detail-$flightId',
          interval: const Duration(milliseconds: 5000),
          fetch: () => Api.instance.fetchFlightDetail(flightId),
          builder: (context, detail) => Poll<PreAuth>(
            pollKey: 'preauth-$flightId',
            interval: const Duration(milliseconds: 10000),
            fetch: () => Api.instance.fetchPreAuth(flightId),
            builder: (context, preAuth) => _Body(
              flightId: flightId,
              view: view,
              detail: detail,
              preAuth: preAuth,
            ),
          ),
        ),
      ),
    );
  }
}

class _Body extends StatefulWidget {
  const _Body({
    required this.flightId,
    required this.view,
    required this.detail,
    required this.preAuth,
  });

  final String flightId;
  final RecoveryView? view;
  final FlightDetail? detail;
  final PreAuth? preAuth;

  @override
  State<_Body> createState() => _BodyState();
}

class _BodyState extends State<_Body> {
  /// Fires at most once per mount, matching the `told` ref in the original.
  bool _told = false;

  @override
  void didUpdateWidget(covariant _Body old) {
    super.didUpdateWidget(old);
    _maybeNotify();
  }

  void _maybeNotify() {
    if (_told) return;
    final v = widget.view;
    final d = widget.detail;
    if (v == null) return;

    if (v.phase == 'booked' && d != null) {
      final alt = d.alts.where((a) => a.id == v.chosenAltId).firstOrNull;
      if (alt == null) return;
      _told = true;
      notifyBooked(
        widget.flightId,
        alt.code,
        alt.dep,
        v.owedNow != 0 ? '${money(v.owedNow)} to you' : 'you paid nothing',
      ).catchError((_) {});
    } else if (v.phase == 'handed') {
      _told = true;
      notifyHandedOver(widget.flightId).catchError((_) {});
    }
  }

  Future<void> _act(Map<String, dynamic> action) async {
    // The returned view is discarded on purpose — the 1.5s poll is the single
    // source of truth, so there is never a moment where two of them disagree.
    await Api.instance.resolve(widget.flightId, action);
  }

  @override
  Widget build(BuildContext context) {
    final world = context.watch<World>();
    final schedule = world.schedule;
    final view = widget.view;
    final detail = widget.detail;

    final f = schedule?.upcoming
        .where((x) => x.id == widget.flightId)
        .firstOrNull;
    final booking = f?.booking;

    if (schedule == null ||
        view == null ||
        detail == null ||
        f == null ||
        booking == null) {
      return const PageBody(children: [PageHead('Recovering your trip')]);
    }

    final scheme = Theme.of(context).colorScheme;
    final now = DateTime.now();
    final phase = view.phase;
    final gateOpen = phase == 'waiting' || phase == 'choosing';

    final alt = detail.alts.where((a) => a.id == view.chosenAltId).firstOrNull;
    final hotel = detail.hotels.where((h) => h.id == view.chosenHotelId).firstOrNull ??
        (detail.hotels.isEmpty ? null : detail.hotels.first);
    final cab = detail.cabs.where((c) => c.id == view.chosenCabId).firstOrNull ??
        (detail.cabs.isEmpty ? null : detail.cabs.first);
    final hotelCost = hotel == null ? 0 : (hotel.extra != 0 ? hotel.extra : hotel.rate);
    final elapsed = view.shown.fold<double>(0, (a, s) => a + s.d);
    final autopilot = schedule.passenger.consent == 'autopilot';

    final waitingNote = autopilot
        ? ' If you say nothing, we book all of it.'
        : view.owedNow == 0
            ? " You asked to be consulted first — but this costs you nothing, "
                "so if you don't answer we'll book it rather than leave you stranded."
            : ' You asked to be consulted first, and this would cost you '
                "${money(view.owedNow)} — so if you don't answer, we stop.";

    return PageBody(children: [
      PageHead(
        '${f.code} was cancelled',
        lede: Text(
          '${f.from} → ${f.to}, was due to depart ${hhmm(f.departure)} today. '
          'Detected ${agoLabel(DateTime.fromMillisecondsSinceEpoch(view.detectedAt), now)}.',
        ),
      ),

      if (view.note != null && phase != 'handed') ...[
        PanelCard(
          title: 'Why this happened',
          titleColor: scheme.primary,
          children: [Text(view.note!, style: const TextStyle(height: 1.6))],
        ),
        const SizedBox(height: 14),
      ],

      // The warm half: ran hours ago, off the critical path, nothing booked.
      PanelCard(children: [
        Row(children: [
          Expanded(
            child: Text('BEFORE IT WAS CANCELLED',
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    letterSpacing: 1.5, color: scheme.onSurfaceVariant)),
          ),
          Text('${secs(warmTotal)} · already done',
              style: Theme.of(context)
                  .textTheme
                  .labelSmall
                  ?.copyWith(color: scheme.onSurfaceVariant)),
        ]),
        const SizedBox(height: 10),
        Text(
          'Your flight was flagged at risk hours ago, so this ran then — off '
          'the critical path, with nothing booked and nothing spent. It is the '
          'only reason the part below takes seconds.',
          style: Theme.of(context)
              .textTheme
              .bodySmall
              ?.copyWith(color: scheme.onSurfaceVariant, height: 1.5),
        ),
        const SizedBox(height: 16),
        for (var i = 0; i < warmSteps.length; i++)
          _Ev(
            step: warmSteps[i],
            state: _EvState.warm,
            last: i == warmSteps.length - 1,
          ),
      ]),
      const SizedBox(height: 14),

      // The live half.
      PanelCard(children: [
        Row(children: [
          Expanded(
            child: Text('THE MOMENT IT WAS CANCELLED',
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    letterSpacing: 1.5, color: scheme.onSurfaceVariant)),
          ),
          Text(
            phase == 'booked'
                ? '${secs(elapsed)} of ${secs(machineTotal)}'
                : secs(elapsed),
            style: Theme.of(context)
                .textTheme
                .labelSmall
                ?.copyWith(color: scheme.onSurfaceVariant),
          ),
        ]),
        const SizedBox(height: 10),
        Text(
          widget.preAuth != null
              ? 'You authorised this beforehand, so there was no waiting on a '
                  'human at all — this is the entire recovery.'
              : 'Machine time only. The window you get to object is yours, and '
                  'is not counted here.',
          style: Theme.of(context)
              .textTheme
              .bodySmall
              ?.copyWith(color: scheme.onSurfaceVariant, height: 1.5),
        ),
        const SizedBox(height: 16),

        if (phase == 'deciding')
          const _Ev(
            step: Step(
              n: 'Working it out',
              d: 0,
              s: 'Confirming the cancellation and locking in your alternative '
                  '— a few seconds.',
            ),
            state: _EvState.busy,
            last: true,
          ),
        for (var i = 0; i < view.shown.length; i++)
          _Ev(
            step: view.shown[i],
            state: (i == view.shown.length - 1 && phase == 'acting')
                ? _EvState.busy
                : _EvState.done,
            last: i == view.shown.length - 1 &&
                !gateOpen &&
                phase != 'handed',
          ),

        if (gateOpen)
          _Gate(
            view: view,
            detail: detail,
            booking: booking,
            alt: alt,
            hotel: hotel,
            cab: cab,
            hotelCost: hotelCost,
            waitingNote: waitingNote,
            autopilot: autopilot,
            onAct: _act,
          ),

        if (phase == 'handed') _StoppedBox(note: view.note),
      ]),

      if (phase == 'booked' && alt != null && hotel != null && cab != null) ...[
        const SizedBox(height: 14),
        _BookedCards(
          f: f,
          view: view,
          detail: detail,
          alt: alt,
          hotel: hotel,
          cab: cab,
          booking: booking,
          hotelCost: hotelCost,
        ),
      ],
    ]);
  }
}

// ── timeline ───────────────────────────────────────────────────────────────

enum _EvState { warm, done, busy }

class _Ev extends StatelessWidget {
  const _Ev({required this.step, required this.state, required this.last});
  final Step step;
  final _EvState state;
  final bool last;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final col = switch (state) {
      _EvState.busy => Tones.warn,
      _EvState.warm => scheme.onSurfaceVariant,
      _EvState.done => scheme.primary,
    };

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            children: [
              Container(
                width: 20,
                height: 20,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: col, width: 2),
                  // Hollow while busy, filled once done — the only visual
                  // difference between "running" and "finished".
                  color: state == _EvState.busy ? Colors.transparent : col,
                ),
                child: state == _EvState.busy
                    ? null
                    : Icon(Icons.check, size: 12, color: scheme.surface),
              ),
              if (!last)
                Expanded(
                  child: Container(
                    width: 2,
                    // 0.28 was tuned against #080c14; on white the rail
                    // connecting the steps all but disappears.
                    color: col.withValues(alpha: 0.45),
                  ),
                ),
            ],
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: last ? 0 : 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          step.n,
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color: state == _EvState.warm
                                ? scheme.onSurfaceVariant
                                : scheme.onSurface,
                          ),
                        ),
                      ),
                      if (step.d > 0)
                        Text(secs(step.d),
                            style: Theme.of(context)
                                .textTheme
                                .labelSmall
                                ?.copyWith(color: scheme.onSurfaceVariant)),
                    ],
                  ),
                  if (step.s.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      step.s,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: scheme.onSurfaceVariant, height: 1.45),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── the consent gate ───────────────────────────────────────────────────────

class _Gate extends StatelessWidget {
  const _Gate({
    required this.view,
    required this.detail,
    required this.booking,
    required this.alt,
    required this.hotel,
    required this.cab,
    required this.hotelCost,
    required this.waitingNote,
    required this.autopilot,
    required this.onAct,
  });

  final RecoveryView view;
  final FlightDetail detail;
  final Booking booking;
  final Alt? alt;
  final HotelOpt? hotel;
  final CabOpt? cab;
  final num hotelCost;
  final String waitingNote;
  final bool autopilot;
  final Future<void> Function(Map<String, dynamic>) onAct;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final choosing = view.phase == 'choosing';
    final col = choosing ? Tones.warn : scheme.primary;

    final label = choosing
        ? 'HELD WHILE YOU DECIDE'
        : autopilot
            ? 'BOOKING UNLESS YOU STOP US'
            : 'WAITING FOR YOU';

    final fraction = view.windowSeconds <= 0
        ? 0.0
        : (view.secondsLeft / view.windowSeconds).clamp(0.0, 1.0);

    return Container(
      margin: const EdgeInsets.only(top: 4),
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: toneSoft(col),
        border: Border.all(color: toneEdge(col)),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: Text(label,
                    style: Theme.of(context)
                        .textTheme
                        .labelSmall
                        ?.copyWith(letterSpacing: 1.5, color: col)),
              ),
              Text(
                '${view.secondsLeft}s',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: col,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          // Drains left-to-right as the window runs out. Steps once per poll —
          // there is no tween, because the server owns this number.
          ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: LinearProgressIndicator(
              value: fraction,
              minHeight: 4,
              backgroundColor: scheme.onSurface.withValues(alpha: 0.09),
              valueColor: AlwaysStoppedAnimation<Color>(col),
            ),
          ),
          const SizedBox(height: 13),
          if (choosing)
            _ChoosingView(view: view, detail: detail, onAct: onAct)
          else if (alt != null && hotel != null && cab != null)
            _WaitingView(
              view: view,
              detail: detail,
              booking: booking,
              alt: alt!,
              hotel: hotel!,
              cab: cab!,
              hotelCost: hotelCost,
              waitingNote: waitingNote,
              onAct: onAct,
            ),
        ],
      ),
    );
  }
}

class _WaitingView extends StatelessWidget {
  const _WaitingView({
    required this.view,
    required this.detail,
    required this.booking,
    required this.alt,
    required this.hotel,
    required this.cab,
    required this.hotelCost,
    required this.waitingNote,
    required this.onAct,
  });

  final RecoveryView view;
  final FlightDetail detail;
  final Booking booking;
  final Alt alt;
  final HotelOpt hotel;
  final CabOpt cab;
  final num hotelCost;
  final String waitingNote;
  final Future<void> Function(Map<String, dynamic>) onAct;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Here is the whole plan — the flight, the room and both cab legs.'
          '$waitingNote',
          style: const TextStyle(height: 1.5),
        ),
        const _GrpLabel('Flight'),
        _PlanLine(
          icon: '✈',
          t1: '${alt.code} · ${alt.dep}',
          t2: 'arrives ${alt.arr} · ${alt.cabin} · seat ${booking.seat}',
          right: alt.fare != 0 ? money(alt.fare) : 'no cost',
          free: alt.fare == 0,
        ),
        const _GrpLabel('Room tonight'),
        _PlanLine(
          icon: 'BED',
          t1: hotel.name,
          t2: '${hotel.area} · check-in ${hotel.checkin} · ${hotel.walk}',
          right: hotelCost != 0 ? money(hotelCost) : 'airline pays',
          free: hotelCost == 0,
        ),
        _GrpLabel('Cab · ${cab.kind}'),
        for (final l in detail.cabLegs)
          _PlanLine(
            icon: 'CAB',
            t1: '${l.from} → ${l.to}',
            t2: '${cab.kind} · pickup ${l.pickup} · ${l.note}',
            // Half the cab extra per leg: the quoted figure covers both.
            right: cab.extra != 0 ? money(cab.extra / 2) : 'airline pays',
            free: cab.extra == 0,
          ),
        const SizedBox(height: 14),
        FilledButton(
          onPressed: () => onAct({'kind': 'approve'}),
          child: const Text('Yes, book it now'),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: () => onAct({'kind': 'browse'}),
          child: const Text('Show me other options'),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: () => onAct({'kind': 'hand-over'}),
          child: const Text("I'll take it from here"),
        ),
      ],
    );
  }
}

class _ChoosingView extends StatelessWidget {
  const _ChoosingView({
    required this.view,
    required this.detail,
    required this.onAct,
  });

  final RecoveryView view;
  final FlightDetail detail;
  final Future<void> Function(Map<String, dynamic>) onAct;

  @override
  Widget build(BuildContext context) {
    final bookable = detail.alts
        .where((a) => a.ok && !view.rejectedAltIds.contains(a.id))
        .length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '$bookable of ${detail.alts.length} work for you. The rest are '
          'blocked by your own policy — we’ll tell you which rule, not just '
          '“unavailable”.',
          style: const TextStyle(height: 1.5),
        ),
        const _GrpLabel('Flights'),
        for (final a in detail.alts)
          () {
            final rejected = view.rejectedAltIds.contains(a.id);
            final usable = a.ok && !rejected;
            return _Opt(
              usable: usable,
              picked: a.id == view.chosenAltId,
              onTap: usable ? () => onAct({'kind': 'choose', 'altId': a.id}) : null,
              title: '${a.code} · ${a.dep}',
              meta: rejected
                  ? 'You rejected this — it can never be re-proposed'
                  : a.ok
                      ? 'arrives ${a.arr} · ${a.cabin} · ${a.seats} seats left'
                      : a.why,
              price: rejected
                  ? 'excluded'
                  : a.ok
                      ? (a.fare != 0 ? money(a.fare) : 'no cost to you')
                      : 'not bookable',
              free: a.ok && a.fare == 0,
            );
          }(),
        const _GrpLabel('Room tonight'),
        for (final h in detail.hotels)
          _Opt(
            usable: h.ok,
            picked: h.id == view.chosenHotelId,
            onTap: h.ok ? () => onAct({'kind': 'swap-hotel', 'hotelId': h.id}) : null,
            title: h.name,
            meta: h.ok ? '${h.area} · check-in ${h.checkin}' : h.why,
            price: h.ok
                ? (h.extra != 0 ? '${money(h.extra)} over' : 'airline pays')
                : 'over the cap',
            free: h.ok && h.extra == 0,
          ),
        const _GrpLabel('Cab for both legs'),
        for (final c in detail.cabs)
          _Opt(
            usable: c.ok,
            picked: c.id == view.chosenCabId,
            onTap: c.ok ? () => onAct({'kind': 'swap-cab', 'cabId': c.id}) : null,
            title: c.kind,
            meta: c.ok ? 'up to ${c.seats} seats · ${c.why}' : c.why,
            price: c.ok
                ? (c.extra != 0 ? '${money(c.extra)} over' : 'airline pays')
                : 'over the cap',
            free: c.ok && c.extra == 0,
          ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: () => onAct({'kind': 'approve'}),
          child: const Text('Book this plan'),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: () => onAct({'kind': 'back'}),
          child: const Text('Back to the plan'),
        ),
      ],
    );
  }
}

class _GrpLabel extends StatelessWidget {
  const _GrpLabel(this.label);
  final String label;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(0, 14, 0, 8),
        child: Text(
          label.toUpperCase(),
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                letterSpacing: 1.5,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
        ),
      );
}

class _PlanLine extends StatelessWidget {
  const _PlanLine({
    required this.icon,
    required this.t1,
    required this.t2,
    required this.right,
    required this.free,
  });

  final String icon, t1, t2, right;
  final bool free;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: Amex.line2,
        border: Border.all(color: scheme.outlineVariant),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 30,
            child: Text(icon,
                style: Theme.of(context)
                    .textTheme
                    .labelSmall
                    ?.copyWith(color: scheme.onSurfaceVariant)),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(t1, style: const TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 3),
                Text(t2,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant, height: 1.4)),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Text(right,
              style: TextStyle(color: free ? Tones.safe : scheme.onSurface)),
        ],
      ),
    );
  }
}

class _Opt extends StatelessWidget {
  const _Opt({
    required this.usable,
    required this.picked,
    required this.onTap,
    required this.title,
    required this.meta,
    required this.price,
    required this.free,
  });

  final bool usable, picked, free;
  final VoidCallback? onTap;
  final String title, meta, price;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Opacity(
      opacity: usable ? 1 : 0.42,
      child: Container(
        margin: const EdgeInsets.only(bottom: 9),
        decoration: BoxDecoration(
          color: picked ? toneSoft(Tones.safe) : Amex.line2,
          border: Border.all(
              color: picked ? toneEdge(Tones.safe) : scheme.outlineVariant),
          borderRadius: BorderRadius.circular(14),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(13),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title,
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                      const SizedBox(height: 4),
                      Text(meta,
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: scheme.onSurfaceVariant, height: 1.4)),
                      if (picked) ...[
                        const SizedBox(height: 5),
                        Text('✓ WE PICKED THIS',
                            style: Theme.of(context).textTheme.labelSmall
                                ?.copyWith(
                                    color: Tones.safe, letterSpacing: 1.2)),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 104),
                  child: Text(
                    usable ? price : price.toUpperCase(),
                    textAlign: TextAlign.right,
                    style: usable
                        ? TextStyle(color: free ? Tones.safe : scheme.onSurface)
                        : const TextStyle(
                            color: Tones.risk, fontSize: 10, letterSpacing: 0.8),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _StoppedBox extends StatelessWidget {
  const _StoppedBox({required this.note});
  final String? note;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 4),
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: toneSoft(Tones.risk),
        border: Border.all(color: toneEdge(Tones.risk)),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('STOPPED',
              style: Theme.of(context)
                  .textTheme
                  .labelSmall
                  ?.copyWith(letterSpacing: 1.5, color: Tones.risk)),
          const SizedBox(height: 10),
          if (note != null) Text(note!, style: const TextStyle(height: 1.5)),
          const SizedBox(height: 14),
          OutlinedButton(
            onPressed: () => Navigator.of(context)
                .popUntil((r) => r.isFirst),
            child: const Text('Back to my flights'),
          ),
        ],
      ),
    );
  }
}

class _BookedCards extends StatelessWidget {
  const _BookedCards({
    required this.f,
    required this.view,
    required this.detail,
    required this.alt,
    required this.hotel,
    required this.cab,
    required this.booking,
    required this.hotelCost,
  });

  final FlightSummary f;
  final RecoveryView view;
  final FlightDetail detail;
  final Alt alt;
  final HotelOpt hotel;
  final CabOpt cab;
  final Booking booking;
  final num hotelCost;

  @override
  Widget build(BuildContext context) {
    final firstHotel = detail.hotels.isEmpty ? null : detail.hotels.first;
    final firstCab = detail.cabs.isEmpty ? null : detail.cabs.first;

    return Column(children: [
      PanelCard(
        title: 'Your trip now',
        titleColor: Tones.safe,
        children: [
          _Diff('Flight', '${f.code} · ${hhmm(f.departure)}', 'Rebooked',
              '${alt.code} · ${alt.dep}',
              first: true),
          _Diff(
            'Hotel',
            '${firstHotel?.name ?? '—'}, 14:00',
            hotel.id == firstHotel?.id ? 'Re-timed' : 'Changed',
            '${hotel.name}, ${hotel.checkin}',
          ),
          _Diff(
            'Cab',
            firstCab?.kind ?? '—',
            cab.id == firstCab?.id ? 'Re-timed' : 'Upgraded',
            '${cab.kind}, both legs',
          ),
          _Diff('Record locator', booking.pnr, 'Reissued',
              'new reference on file'),
        ],
      ),
      const SizedBox(height: 14),
      PanelCard(title: 'What it cost you', children: [
        KV('Flight fare difference',
            alt.fare != 0 ? money(alt.fare) : 'airline pays',
            tone: alt.fare != 0 ? Tones.warn : Tones.safe, first: true),
        KV('Room · ${hotel.name}',
            hotelCost != 0 ? '${money(hotelCost)} over the allowance' : 'airline pays',
            tone: hotelCost != 0 ? Tones.warn : Tones.safe),
        KV('Cab · ${cab.kind}, both legs',
            cab.extra != 0 ? '${money(cab.extra)} over the allowance' : 'airline pays',
            tone: cab.extra != 0 ? Tones.warn : Tones.safe),
        KV('Charged to your card',
            view.owedNow != 0 ? money(view.owedNow) : 'nothing',
            tone: view.owedNow != 0 ? Tones.warn : Tones.safe, total: true),
        KV('Decision time', secs(decideTotal)),
        KV('Execution time', secs(actTotal)),
        KV('Prepared in advance', '${secs(warmTotal)}, before it happened'),
        const SizedBox(height: 14),
        OutlinedButton(
          onPressed: () => Navigator.of(context).popUntil((r) => r.isFirst),
          child: const Text('Back to my flights'),
        ),
      ]),
    ]);
  }
}

class _Diff extends StatelessWidget {
  const _Diff(this.k1, this.v1, this.k2, this.v2, {this.first = false});
  final String k1, v1, k2, v2;
  final bool first;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final label = Theme.of(context)
        .textTheme
        .labelSmall
        ?.copyWith(letterSpacing: 1.2, color: scheme.onSurfaceVariant);

    return Container(
      padding: EdgeInsets.only(top: first ? 0 : 13, bottom: 13),
      decoration: first
          ? null
          : BoxDecoration(
              border: Border(top: BorderSide(color: Amex.line2))),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Opacity(
              opacity: 0.45,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(k1.toUpperCase(), style: label),
                  const SizedBox(height: 4),
                  Text(v1,
                      style: const TextStyle(
                          decoration: TextDecoration.lineThrough)),
                ],
              ),
            ),
          ),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 10),
            child: Text('→', style: TextStyle(color: Tones.brand, fontSize: 14)),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(k2.toUpperCase(), style: label),
                const SizedBox(height: 4),
                Text(v2, style: const TextStyle(color: Tones.safe)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
