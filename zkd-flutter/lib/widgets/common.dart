import 'package:flutter/material.dart';

import '../api/models.dart';
import '../theme.dart';
import '../util/time.dart';

Color colorForTone(Tone t) => switch (t) {
      Tone.high => Tones.risk,
      Tone.mid => Tones.warn,
      Tone.low => Tones.safe,
    };

/// Section heading between cards.
class SectionHeader extends StatelessWidget {
  const SectionHeader(this.label, {super.key});
  final String label;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme.labelMedium;
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 26, 4, 10),
      child: Text(
        label.toUpperCase(),
        style: t?.copyWith(
          letterSpacing: 1.6,
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        ),
      ),
    );
  }
}

/// Card with a title row, the workhorse container on every screen.
class PanelCard extends StatelessWidget {
  const PanelCard({
    super.key,
    this.title,
    this.titleColor,
    required this.children,
    this.padding = const EdgeInsets.all(16),
  });

  final String? title;
  final Color? titleColor;
  final List<Widget> children;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: padding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (title != null) ...[
              Text(
                title!.toUpperCase(),
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      letterSpacing: 1.5,
                      color: titleColor ?? scheme.onSurfaceVariant,
                    ),
              ),
              const SizedBox(height: 12),
            ],
            ...children,
          ],
        ),
      ),
    );
  }
}

/// Key/value row. `total` gives it the heavier rule and weight used for the
/// bottom line of a cost breakdown.
class KV extends StatelessWidget {
  const KV(
    this.k,
    this.v, {
    super.key,
    this.tone,
    this.first = false,
    this.total = false,
  });

  final String k;
  final String v;
  final Color? tone;
  final bool first, total;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    return Container(
      padding: EdgeInsets.only(top: first ? 0 : 10, bottom: 10),
      decoration: first
          ? null
          : BoxDecoration(
              border: Border(
                top: BorderSide(
                  // Solid line tokens, not alpha-reduced ones: on white a 35%
                  // #D8DCE3 rule is ~#F5F6F8 and simply does not render.
                  color: total ? Amex.line : Amex.line2,
                  width: 1,
                ),
              ),
            ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(
              k,
              style: text.bodyMedium?.copyWith(
                color: total ? scheme.onSurface : scheme.onSurfaceVariant,
                fontWeight: total ? FontWeight.w600 : null,
              ),
            ),
          ),
          const SizedBox(width: 14),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 168),
            child: Text(
              v,
              textAlign: TextAlign.right,
              style: text.bodyMedium?.copyWith(
                fontFeatures: const [FontFeature.tabularFigures()],
                color: tone ?? scheme.onSurface,
                fontWeight: total ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The explanatory footnote inside a card.
class Why extends StatelessWidget {
  const Why(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Container(
        padding: const EdgeInsets.only(top: 12),
        decoration: BoxDecoration(
          border: Border(
            top: BorderSide(color: Amex.line2),
          ),
        ),
        child: Text(
          text,
          style: Theme.of(context)
              .textTheme
              .bodySmall
              ?.copyWith(color: scheme.onSurfaceVariant, height: 1.5),
        ),
      ),
    );
  }
}

class TonePill extends StatelessWidget {
  const TonePill(this.label, {super.key, required this.color});
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: toneSoft(color),
        border: Border.all(color: toneEdge(color)),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: Theme.of(context)
                .textTheme
                .labelSmall
                ?.copyWith(color: color, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

/// Origin — duration — destination, with the times underneath.
class RouteLine extends StatelessWidget {
  const RouteLine({
    super.key,
    required this.from,
    required this.to,
    required this.dep,
    required this.arr,
    required this.dur,
  });

  final String from, to, dep, arr, dur;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    Widget end(String code, String time, CrossAxisAlignment align) => Column(
          crossAxisAlignment: align,
          children: [
            Text(
              code,
              style: text.titleLarge?.copyWith(
                fontWeight: FontWeight.w700,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
            const SizedBox(height: 3),
            Text(time,
                style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
          ],
        );

    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        end(from, dep, CrossAxisAlignment.start),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Column(
              children: [
                Text(dur,
                    style: text.labelSmall
                        ?.copyWith(color: scheme.onSurfaceVariant)),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Expanded(child: Container(height: 1, color: scheme.outlineVariant)),
                    Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(
                          color: scheme.primary, shape: BoxShape.circle),
                    ),
                    SizedBox(
                      width: 24,
                      child: Container(height: 1, color: scheme.outlineVariant),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        end(to, arr, CrossAxisAlignment.end),
      ],
    );
  }
}

/// Page title and optional lede, matching the RN PageHead.
class PageHead extends StatelessWidget {
  const PageHead(this.title, {super.key, this.lede});
  final String title;
  final Widget? lede;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 8, 4, 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: Theme.of(context).textTheme.headlineSmall),
          if (lede != null) ...[const SizedBox(height: 8), lede!],
        ],
      ),
    );
  }
}

/// Standard scroll body so every screen has the same padding and bottom inset.
class PageBody extends StatelessWidget {
  const PageBody({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: EdgeInsets.fromLTRB(
          16, 8, 16, 40 + MediaQuery.of(context).padding.bottom),
      children: children,
    );
  }
}

String flightWindow(FlightSummary f) =>
    '${hhmm(f.departure)} – ${hhmm(f.arrival)}';
