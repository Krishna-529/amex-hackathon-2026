import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmanager/workmanager.dart';

import 'api/client.dart';
import 'api/models.dart';
import 'notify.dart';
import 'util/time.dart';

const String scheduleBackgroundPollTask = 'zkd-schedule-poll';

/// The pref key the background task's own phase baseline lives under. Kept
/// separate from World's in-memory `_seenPhases`: the two poll on independent
/// schedules, so whichever one sees a flip first fires the notification, and
/// the other's baseline simply catches up without re-firing.
const String _phaseBaselineKey = 'zkd_bg_last_phases';

/// Runs in a background isolate with no Provider/BuildContext — everything it
/// touches (Api, the model parsers, notifyCancelled) has to work standalone.
@pragma('vm:entry-point')
void callbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    await setupNotifications();
    await Api.instance.init();

    final me = await Api.instance.fetchMe();
    if (me == null) return Future.value(true);

    final schedule = await Api.instance.fetchSchedule(me.id);
    if (schedule == null) return Future.value(true);

    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_phaseBaselineKey);
    final isFirst = raw == null;
    final prevPhases = isFirst
        ? <String, String>{}
        : Map<String, String>.from(jsonDecode(raw) as Map);

    final nextPhases = <String, String>{};
    for (final f in schedule.upcoming) {
      nextPhases[f.id] = f.disruptionPhase;
      if (!isFirst) {
        final prev = prevPhases[f.id] ?? 'none';
        if (prev == 'none' && f.disruptionPhase != 'none') {
          await notifyCancelled(
            f.id,
            f.code,
            hhmm(f.departure),
            schedule.passenger.consent == 'autopilot',
          ).catchError((_) {});
        }
      }
    }
    await prefs.setString(_phaseBaselineKey, jsonEncode(nextPhases));

    return Future.value(true);
  });
}

Future<void> registerBackgroundPoll() {
  return Workmanager().registerPeriodicTask(
    scheduleBackgroundPollTask,
    scheduleBackgroundPollTask,
    frequency: const Duration(minutes: 15), // AndroidX's enforced floor
    constraints: Constraints(networkType: NetworkType.connected),
    existingWorkPolicy: ExistingWorkPolicy.keep,
  );
}

Future<void> cancelBackgroundPoll() {
  return Workmanager().cancelByUniqueName(scheduleBackgroundPollTask);
}
