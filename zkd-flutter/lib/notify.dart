import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Real Android notifications, ported from zkd-android/src/notify.ts.
///
/// Two channels, because the same product has two urgencies: a cancellation has
/// to interrupt (that is the entire point of the app), a booking confirmation
/// must not.
///
/// These are LOCAL notifications: the app noticed a change it was already
/// polling for and raised the banner itself, so they only fire while the app is
/// running. Reaching someone with the app closed needs remote push (FCM), which
/// is a later step — see the plan. A missing FCM setup degrades this rather than
/// removing it.
const String channelDisruption = 'disruption';
const String channelUpdates = 'updates';

/// Set by main() so a notification tap can navigate without a BuildContext.
final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();

/// Where a tapped notification should land. Every action and the body itself
/// point at the same place: the recovery the member is being asked about.
void Function(String flightId)? onNotificationTap;

Future<void> setupNotifications() async {
  const android = AndroidInitializationSettings('@mipmap/ic_launcher');
  await _plugin.initialize(
    settings: const InitializationSettings(android: android),
    onDidReceiveNotificationResponse: (response) {
      final id = response.payload;
      if (id != null && id.isNotEmpty) onNotificationTap?.call(id);
    },
  );

  final android_ = _plugin.resolvePlatformSpecificImplementation<
      AndroidFlutterLocalNotificationsPlugin>();
  if (android_ == null) return;

  // Disruptions must interrupt.
  await android_.createNotificationChannel(const AndroidNotificationChannel(
    channelDisruption,
    'Flight disruptions',
    description: 'Your flight was cancelled or delayed and we are acting on it',
    importance: Importance.max,
    playSound: true,
    enableVibration: true,
  ));
  // Confirmations should not. Same product, different urgency.
  await android_.createNotificationChannel(const AndroidNotificationChannel(
    channelUpdates,
    'Booking updates',
    description: 'Confirmations once your trip has been put back together',
    importance: Importance.defaultImportance,
  ));

  // Android 13+ requires this at runtime; older versions grant it at install.
  await android_.requestNotificationsPermission();
}

final Int64List _urgentPattern = Int64List.fromList([0, 320, 160, 320]);

Future<void> notifyCancelled(
  String flightId,
  String flight,
  String dep,
  bool autopilot,
) {
  return _plugin.show(
    id: flightId.hashCode & 0x7fffffff,
    title: '$flight has been cancelled',
    body: autopilot
        ? "Due to depart $dep. We're rebooking you now — tap to stop us."
        : 'Due to depart $dep. We need your go-ahead before we book anything.',
    notificationDetails: NotificationDetails(
      android: AndroidNotificationDetails(
        channelDisruption,
        'Flight disruptions',
        importance: Importance.max,
        priority: Priority.max,
        color: const Color(0xFFD9615A),
        vibrationPattern: _urgentPattern,
        styleInformation: const BigTextStyleInformation(''),
      ),
    ),
    payload: flightId,
  );
}

Future<void> notifyBooked(
  String flightId,
  String code,
  String dep,
  String owed,
) {
  return _plugin.show(
    id: (flightId.hashCode & 0x7fffffff) ^ 1,
    title: 'Rebooked — your trip is back together',
    body: '$code at $dep · hotel and cab moved · $owed',
    notificationDetails: const NotificationDetails(
      android: AndroidNotificationDetails(
        channelUpdates,
        'Booking updates',
        color: Color(0xFF4BAB7C),
        styleInformation: BigTextStyleInformation(''),
      ),
    ),
    payload: flightId,
  );
}

Future<void> notifyHandedOver(String flightId) {
  return _plugin.show(
    id: (flightId.hashCode & 0x7fffffff) ^ 2,
    title: 'A person has taken over',
    body: 'Nothing was booked and nothing was charged. Meera has your full context.',
    notificationDetails: const NotificationDetails(
      android: AndroidNotificationDetails(
        channelUpdates,
        'Booking updates',
        color: Color(0xFF2F7FF0),
        styleInformation: BigTextStyleInformation(''),
      ),
    ),
    payload: flightId,
  );
}
