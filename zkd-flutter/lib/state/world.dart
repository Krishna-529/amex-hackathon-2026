import 'dart:async';

import 'package:flutter/foundation.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../notify.dart';
import '../util/time.dart';

enum AuthStatus { loading, authenticated, anonymous }

/// The global store — a thin poller of the same server-authoritative engine
/// every web tab reads (zkd-app/server/engine/simulation.ts).
///
/// Identity comes from the signed-in session, not a hardcoded passenger id.
/// There is no identity switcher, because there is nothing to switch between:
/// whoever is signed in on this phone is the only passenger it can see or act as.
class World extends ChangeNotifier {
  AuthStatus status = AuthStatus.loading;
  String? passengerId;
  String? displayName;
  PassengerSchedule? schedule;

  Timer? _scheduleTimer;
  bool _scheduleInFlight = false;

  /// null means "we have not seen a first poll yet". Without this distinction a
  /// flight that is ALREADY disrupted when the app opens would fire a
  /// notification on launch, every launch.
  Map<String, String>? _seenPhases;

  /// Device registration is keyed on passenger, not run on mount: the server
  /// binds the token to the SESSION's passenger, so calling it before sign-in
  /// just 401s. Re-running for a different passenger stops a shared demo phone
  /// delivering the previous member's alerts.
  String? _registeredFor;

  Future<void> boot() async {
    await Api.instance.init();
    final me = await Api.instance.fetchMe();
    _applyMe(me);
  }

  void _applyMe(Me? me) {
    if (me != null) {
      passengerId = me.id;
      displayName = me.displayName;
      status = AuthStatus.authenticated;
      _startSchedulePoll();
    } else {
      passengerId = null;
      displayName = null;
      schedule = null;
      status = AuthStatus.anonymous;
      _seenPhases = null;
      _registeredFor = null;
      _scheduleTimer?.cancel();
      _scheduleTimer = null;
    }
    notifyListeners();
  }

  /// Returns an error string, or null on success. On success there is no
  /// navigation to do — status flips and the root swaps the whole route set.
  Future<String?> signIn(String email, String password) async {
    final result = await Api.instance.login(email, password);
    if (result.error != null) return result.error;
    _applyMe(result.me);
    return null;
  }

  Future<void> signOut() async {
    await Api.instance.logout();
    await Api.instance.clearCookies();
    _applyMe(null);
  }

  /// Fire-and-forget, deliberately: there is no optimistic update, so the
  /// segmented control only moves once the next poll confirms what took.
  Future<void> setConsent(String consent) async {
    final id = passengerId;
    if (id == null) return;
    await Api.instance.setConsent(id, consent);
  }

  void _startSchedulePoll() {
    _scheduleTimer?.cancel();
    _pollSchedule();
    _scheduleTimer =
        Timer.periodic(const Duration(milliseconds: 4000), (_) => _pollSchedule());
  }

  Future<void> _pollSchedule() async {
    final id = passengerId;
    if (id == null || _scheduleInFlight) return;
    _scheduleInFlight = true;
    try {
      final next = await Api.instance.fetchSchedule(id);
      if (next == null) return; // keep the last good value
      schedule = next;
      _detectPhaseFlips(next);
      _registerDeviceOnce(id);
      notifyListeners();
    } finally {
      _scheduleInFlight = false;
    }
  }

  /// A real notification the moment ANY flight flips out of 'none' — the phone
  /// noticing a change the backend already made, not a local timer standing in
  /// for detection.
  void _detectPhaseFlips(PassengerSchedule s) {
    final isFirst = _seenPhases == null;
    final next = <String, String>{};
    for (final f in s.upcoming) {
      next[f.id] = f.disruptionPhase;
      if (!isFirst) {
        final prev = _seenPhases![f.id] ?? 'none';
        if (prev == 'none' && f.disruptionPhase != 'none') {
          notifyCancelled(
            f.id,
            f.code,
            hhmm(f.departure),
            s.passenger.consent == 'autopilot',
          ).catchError((_) {});
        }
      }
    }
    _seenPhases = next;
  }

  void _registerDeviceOnce(String id) {
    if (_registeredFor == id) return;
    _registeredFor = id;
    // Local notifications are the working path today. A remote push token needs
    // FCM, which is not wired yet, so there is nothing to hand over here until
    // that lands — see lib/notify.dart and the plan's FCM section.
  }

  @override
  void dispose() {
    _scheduleTimer?.cancel();
    super.dispose();
  }
}
