import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:workmanager/workmanager.dart';

import 'background_task.dart';
import 'notify.dart';
import 'screens/flight_detail.dart';
import 'screens/flights.dart';
import 'screens/login.dart';
import 'screens/profile.dart';
import 'screens/recovery.dart';
import 'state/world.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await setupNotifications();
  // One-time registration of the background isolate's entry point. Actually
  // scheduling/cancelling the periodic task happens per-session in World, so
  // a signed-out phone doesn't keep polling a stale cookie.
  await Workmanager().initialize(callbackDispatcher);
  final world = World();
  // Restores the session from the persisted cookie jar before the first frame
  // decides which route set to show, so a signed-in member does not flash the
  // login screen on every cold start.
  await world.boot();
  runApp(ChangeNotifierProvider.value(value: world, child: const ZkdApp()));
}

class ZkdApp extends StatefulWidget {
  const ZkdApp({super.key});

  @override
  State<ZkdApp> createState() => _ZkdAppState();
}

class _ZkdAppState extends State<ZkdApp> {
  @override
  void initState() {
    super.initState();
    // A tapped notification always means the same thing: open the recovery the
    // member is being asked about.
    onNotificationTap = (flightId) {
      navigatorKey.currentState?.pushNamed(RecoveryScreen.route, arguments: flightId);
    };
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ZKD Concierge',
      debugShowCheckedModeBanner: false,
      navigatorKey: navigatorKey,
      theme: buildTheme(),
      home: const _Root(),
      onGenerateRoute: (settings) {
        final id = settings.arguments as String?;
        return switch (settings.name) {
          FlightsScreen.route =>
            MaterialPageRoute<void>(builder: (_) => const FlightsScreen()),
          FlightDetailScreen.route => MaterialPageRoute<void>(
              builder: (_) => FlightDetailScreen(flightId: id ?? '')),
          RecoveryScreen.route => MaterialPageRoute<void>(
              builder: (_) => RecoveryScreen(flightId: id ?? '')),
          ProfileScreen.route =>
            MaterialPageRoute<void>(builder: (_) => const ProfileScreen()),
          _ => null,
        };
      },
    );
  }
}

/// Swaps the entire screen set on sign-in/sign-out. There is no identity
/// switcher: whoever is signed in on this phone is the only passenger it can
/// see or act as.
class _Root extends StatelessWidget {
  const _Root();

  @override
  Widget build(BuildContext context) {
    final status = context.select<World, AuthStatus>((w) => w.status);
    return switch (status) {
      AuthStatus.loading =>
        const Scaffold(body: Center(child: CircularProgressIndicator())),
      AuthStatus.anonymous => const LoginScreen(),
      AuthStatus.authenticated => const FlightsScreen(),
    };
  }
}
