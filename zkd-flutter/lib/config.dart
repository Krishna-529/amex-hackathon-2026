/// Where the phone finds the backend.
///
/// Compiled in, so changing it is a rebuild rather than a restart. Override at
/// build time instead of editing this file:
///
///   flutter build apk --release --dart-define=API_BASE_URL=http://192.168.0.30:5176
///
/// The default is the hosted AWS box (51.20.144.50:5176), not a LAN address —
/// changed 2026-08-23 so a standalone APK works off-network without a
/// --dart-define override. A phone tethered to the same LAN as a dev machine
/// can still point at that machine's Wi-Fi address via --dart-define.
///
/// Plain HTTP, which is why AndroidManifest.xml sets usesCleartextTraffic.
const String apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://51.20.144.50:5176',
);
