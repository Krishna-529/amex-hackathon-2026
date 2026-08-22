/// Where the phone finds the backend.
///
/// Compiled in, so changing it is a rebuild rather than a restart. Override at
/// build time instead of editing this file:
///
///   flutter build apk --release --dart-define=API_BASE_URL=http://192.168.0.30:5176
///
/// The default is this desktop's Wi-Fi address (verified 2026-08-19 by `ipconfig`:
/// Wireless LAN adapter Wi-Fi = 192.168.0.144). A standalone APK cannot use
/// localhost — the phone is not tethered, so it has to dial the desktop directly.
/// If DHCP moves that address, rebuild with --dart-define rather than patching here.
///
/// Plain HTTP, which is why AndroidManifest.xml sets usesCleartextTraffic.
const String apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://localhost:5176',
);
