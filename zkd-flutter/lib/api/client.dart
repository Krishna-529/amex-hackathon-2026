import 'dart:io';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';
import 'package:path_provider/path_provider.dart';

import '../config.dart';
import 'models.dart';

/// The one place this app talks to a network.
///
/// ── Why a cookie jar, explicitly ──────────────────────────────────────────
///
/// The server's session is a cookie: `zkd_session`, HttpOnly, SameSite=Lax,
/// Path=/, Max-Age 12h (zkd-app/server/auth/session.ts). It is NOT `Secure` in
/// dev, deliberately — a Secure cookie would never be stored over the plain
/// http:// LAN address this app uses.
///
/// React Native got cookie persistence for free: its fetch runs on OkHttp, which
/// keeps a cookie jar by default. Dart has no such default — package:http drops
/// Set-Cookie on the floor, which would make login appear to succeed and every
/// subsequent request 401. So dio + PersistCookieJar is not a preference here,
/// it is the thing that makes the session work at all. HttpOnly restricts
/// browser JavaScript, not a native client, so reading/storing it is fine.
///
/// PersistCookieJar (not CookieJar) so the 12h session survives an app restart,
/// matching the web app's behaviour.
class Api {
  Api._();
  static final Api instance = Api._();

  late final Dio _dio;
  bool _initialised = false;

  Future<void> init() async {
    if (_initialised) return;
    final dir = await getApplicationDocumentsDirectory();
    final jar = PersistCookieJar(
      storage: FileStorage('${dir.path}${Platform.pathSeparator}.zkd-cookies'),
    );
    _dio = Dio(
      BaseOptions(
        baseUrl: apiBaseUrl,
        connectTimeout: const Duration(seconds: 8),
        receiveTimeout: const Duration(seconds: 12),
        responseType: ResponseType.json,
        // Non-2xx must not throw: every caller below treats a failure as null,
        // mirroring getJSON/postJSON in src/api.ts.
        validateStatus: (_) => true,
      ),
    );
    _dio.interceptors.add(CookieManager(jar));
    _initialised = true;
  }

  /// Wipes the stored session cookie. Used on sign-out so a shared demo phone
  /// does not leave the previous member signed in.
  Future<void> clearCookies() async {
    for (final i in _dio.interceptors) {
      if (i is CookieManager) {
        await i.cookieJar.deleteAll();
      }
    }
  }

  // ── plumbing ─────────────────────────────────────────────────────────────
  // Silent on every failure, exactly like the RN original: the UI has no error
  // surface outside the login screen, and a thrown exception mid-poll would
  // otherwise take the whole screen down.

  Future<dynamic> _get(String path) async {
    try {
      final res = await _dio.get<dynamic>(path);
      final code = res.statusCode ?? 0;
      if (code < 200 || code >= 300) return null;
      return res.data;
    } catch (_) {
      return null;
    }
  }

  Future<dynamic> _post(String path, Object? body) async {
    try {
      final res = await _dio.post<dynamic>(path, data: body);
      final code = res.statusCode ?? 0;
      if (code < 200 || code >= 300) return null;
      return res.data;
    } catch (_) {
      return null;
    }
  }

  Map<String, dynamic>? _asMap(dynamic v) =>
      v is Map ? Map<String, dynamic>.from(v) : null;

  // ── auth ─────────────────────────────────────────────────────────────────

  /// Returns the signed-in member, or an error string. Same "not signed in"
  /// shape whether the network failed or the credentials were wrong, so the
  /// login screen shows one honest error.
  Future<({Me? me, String? error})> login(String email, String password) async {
    try {
      final res = await _dio.post<dynamic>(
        '/api/auth/login',
        data: {'email': email, 'password': password},
      );
      final body = _asMap(res.data);
      final code = res.statusCode ?? 0;
      if (code < 200 || code >= 300) {
        return (
          me: null,
          error: body?['error'] as String? ??
              'Something went wrong signing you in.',
        );
      }
      if (body == null) {
        return (me: null, error: 'Something went wrong signing you in.');
      }
      return (me: Me.fromJson(body), error: null);
    } catch (_) {
      return (
        me: null,
        error: 'Could not reach the server. Check your connection and try again.',
      );
    }
  }

  /// Best-effort — the app clears local state regardless of the outcome.
  Future<void> logout() async {
    try {
      await _dio.post<dynamic>('/api/auth/logout');
    } catch (_) {
      // deliberately ignored
    }
  }

  Future<Me?> fetchMe() async {
    final j = _asMap(await _get('/api/auth/me'));
    return j == null ? null : Me.fromJson(j);
  }

  // ── reads ────────────────────────────────────────────────────────────────
  // None of these carry a passenger id as an argument to prove identity — the
  // session cookie IS the passenger on every request, as server/auth/guard.ts
  // enforces. The id in the path is only the resource being addressed, and a
  // mismatch is a 403 rather than a 401.

  Future<PassengerSchedule?> fetchSchedule(String passengerId) async {
    final j = _asMap(await _get('/api/passengers/$passengerId/schedule'));
    return j == null ? null : PassengerSchedule.fromJson(j);
  }

  Future<Passenger?> fetchPassenger(String passengerId) async {
    final j = _asMap(await _get('/api/passengers/$passengerId'));
    return j == null ? null : Passenger.fromJson(j);
  }

  Future<FlightDetail?> fetchFlightDetail(String flightId) async {
    final j = _asMap(await _get('/api/flights/$flightId'));
    return j == null ? null : FlightDetail.fromJson(j);
  }

  /// The server returns the JSON literal `null` when there is no
  /// pre-authorisation, so a null body is a valid, expected answer here — not
  /// an error.
  Future<PreAuth?> fetchPreAuth(String flightId) async {
    final j = _asMap(await _get('/api/flights/$flightId/preauth'));
    return j == null ? null : PreAuth.fromJson(j);
  }

  /// 404s when there is no disruption, or none belonging to this passenger.
  Future<RecoveryView?> fetchRecovery(String flightId) async {
    final j = _asMap(await _get('/api/disruptions/$flightId'));
    return j == null ? null : RecoveryView.fromJson(j);
  }

  // ── writes ───────────────────────────────────────────────────────────────

  /// Fire-and-forget: the next schedule poll shows whatever actually took.
  Future<void> setConsent(String passengerId, String consent) async {
    try {
      await _dio.patch<dynamic>(
        '/api/passengers/$passengerId',
        data: {'consent': consent},
      );
    } catch (_) {
      // deliberately ignored
    }
  }

  /// The seven recovery actions. The returned view is discarded on purpose —
  /// the 1.5s poll picks the change up, so there is exactly one source of truth.
  Future<void> resolve(String flightId, Map<String, dynamic> action) async {
    await _post('/api/disruptions/$flightId/consent', {'action': action});
  }

  /// Hands this device's push token to the server so it can reach the phone
  /// when the app is closed. Session-bound server-side, so it must run AFTER
  /// sign-in — before that there is no session to attach to and it 401s.
  ///
  /// NOTE: /api/devices currently validates the token with `isExpoToken` and
  /// rejects anything else with 400. An FCM token will be refused until that
  /// validation is changed — see the plan's FCM section.
  Future<bool> registerDevice(String token) async {
    return await _post('/api/devices', {'token': token}) != null;
  }
}
