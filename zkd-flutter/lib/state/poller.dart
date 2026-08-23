import 'dart:async';

import 'package:flutter/widgets.dart';

/// The phone's only way of finding anything out — a direct port of
/// zkd-android/src/lib/usePoll.ts.
///
/// Semantics that matter and are easy to get wrong:
///  * fires once immediately, then every [interval];
///  * failures are SWALLOWED and the previous value is kept, so a dropped LAN
///    packet does not blank the screen;
///  * changing [pollKey] resets the value to null, which is what makes
///    navigating between two flights show the loading head rather than the
///    previous flight's data;
///  * a null [pollKey] means "nothing to poll" (e.g. signed out) and stops the
///    timer entirely.
class Poll<T> extends StatefulWidget {
  const Poll({
    super.key,
    required this.pollKey,
    required this.fetch,
    required this.interval,
    required this.builder,
  });

  final String? pollKey;
  final Future<T?> Function() fetch;
  final Duration interval;
  final Widget Function(BuildContext context, T? value) builder;

  @override
  State<Poll<T>> createState() => _PollState<T>();
}

class _PollState<T> extends State<Poll<T>> {
  T? _value;
  Timer? _timer;
  bool _inFlight = false;

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void didUpdateWidget(covariant Poll<T> old) {
    super.didUpdateWidget(old);
    if (old.pollKey != widget.pollKey || old.interval != widget.interval) {
      _value = null;
      _start();
    }
  }

  void _start() {
    _timer?.cancel();
    if (widget.pollKey == null) return;
    _tick();
    _timer = Timer.periodic(widget.interval, (_) => _tick());
  }

  Future<void> _tick() async {
    // Skip rather than queue: on a slow LAN a 1.5s poll can outrun its own
    // response, and stacking them would only make it worse.
    if (_inFlight) return;
    _inFlight = true;
    try {
      final next = await widget.fetch();
      if (!mounted) return;
      if (next != null) setState(() => _value = next);
    } catch (_) {
      // keep the last good value
    } finally {
      _inFlight = false;
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.builder(context, _value);
}
