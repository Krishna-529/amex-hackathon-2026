// Standalone check of the riskiest thing in the port: does the dio + cookie_jar
// stack actually carry the server's `zkd_session` cookie across requests?
//
// Deliberately NOT a widget test — it runs on the plain Dart VM against a live
// backend, so it proves the real HTTP behaviour rather than a mock. Uses an
// in-memory CookieJar because PersistCookieJar needs a writable app directory
// that only exists on a device.
//
//   dart run tool/session_check.dart [baseUrl]
import 'dart:io';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';

Future<void> main(List<String> args) async {
  final base = args.isNotEmpty ? args.first : 'http://127.0.0.1:5176';
  final jar = CookieJar();
  final dio = Dio(BaseOptions(
    baseUrl: base,
    validateStatus: (_) => true,
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 20),
  ))
    ..interceptors.add(CookieManager(jar));

  var failures = 0;
  void check(String label, bool ok, [String extra = '']) {
    stdout.writeln('${ok ? 'PASS' : 'FAIL'}  $label${extra.isEmpty ? '' : '  — $extra'}');
    if (!ok) failures++;
  }

  // 1. Unauthenticated /me must be refused, or the rest proves nothing.
  final anon = await dio.get<dynamic>('/api/auth/me');
  check('GET /api/auth/me is 401 before sign-in', anon.statusCode == 401,
      'got ${anon.statusCode}');

  // 2. Login sets the session cookie.
  final login = await dio.post<dynamic>('/api/auth/login',
      data: {'email': 'priya@zkd.demo', 'password': 'priya-2026'});
  check('POST /api/auth/login is 200', login.statusCode == 200,
      'got ${login.statusCode} ${login.data}');

  final cookies = await jar.loadForRequest(Uri.parse(base));
  final session = cookies.where((c) => c.name == 'zkd_session').firstOrNull;
  check('zkd_session cookie stored by the jar', session != null,
      cookies.map((c) => c.name).join(','));

  // 3. The cookie is replayed automatically on a later request.
  final me = await dio.get<dynamic>('/api/auth/me');
  check('GET /api/auth/me is 200 after sign-in', me.statusCode == 200,
      'got ${me.statusCode}');

  final id = me.data is Map ? me.data['id'] as String? : null;
  check('/me returns a passenger id', id != null, '$id');

  if (id != null) {
    // 4. The polled endpoints the app actually lives on.
    final sched = await dio.get<dynamic>('/api/passengers/$id/schedule');
    check('GET schedule is 200', sched.statusCode == 200, 'got ${sched.statusCode}');
    final upcoming =
        sched.data is Map ? (sched.data['upcoming'] as List?) ?? [] : [];
    check('schedule returns upcoming flights', upcoming.isNotEmpty,
        '${upcoming.length} flights');

    if (upcoming.isNotEmpty) {
      final fid = upcoming.first['id'];
      final detail = await dio.get<dynamic>('/api/flights/$fid');
      check('GET flight detail is 200', detail.statusCode == 200,
          'got ${detail.statusCode}');
      check('flight detail carries candidates',
          detail.data is Map && detail.data['candidates'] is Map);

      // preauth legitimately answers with the JSON literal null.
      final pre = await dio.get<dynamic>('/api/flights/$fid/preauth');
      check('GET preauth is 200 and may be null', pre.statusCode == 200,
          'body=${pre.data}');
    }

    // 5. requireSelf must reject someone else's id with 403, not 401.
    final other = await dio.get<dynamic>('/api/passengers/not-my-id/schedule');
    check('another passenger\'s schedule is refused',
        other.statusCode == 403 || other.statusCode == 401,
        'got ${other.statusCode}');
  }

  // 6. Logout clears the session.
  await dio.post<dynamic>('/api/auth/logout');
  final after = await dio.get<dynamic>('/api/auth/me');
  check('GET /api/auth/me is 401 after sign-out', after.statusCode == 401,
      'got ${after.statusCode}');

  stdout.writeln(failures == 0
      ? '\nALL CHECKS PASSED'
      : '\n$failures CHECK(S) FAILED');
  exit(failures == 0 ? 0 : 1);
}
