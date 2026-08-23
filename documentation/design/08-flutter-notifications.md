# How notifications work on Flutter — local today, FCM token/backend not wired

**ZKD Concierge · Codestreet 2026 / American Express**

Short note, `verified` from source in `zkd-flutter/lib/` and `zkd-app/server/notify/`. Complements
[`07-disruption-detection-explained.md`](07-disruption-detection-explained.md), which covers what
fires a notification; this covers what actually delivers one on the Flutter client.

## What exists today, and what doesn't

Flutter has **local notifications only**. `zkd-flutter/lib/notify.dart` (ported from
`zkd-android/src/notify.ts`) uses `flutter_local_notifications` to raise two Android channels —
`disruption` (max importance, vibration, interrupts) and `updates` (default importance, for
confirmations) — the same two-urgency split the header comment states directly:

> These are LOCAL notifications: the app noticed a change it was already polling for and raised the
> banner itself, so they only fire while the app is running. Reaching someone with the app closed
> needs remote push (FCM), which is a later step ... A missing FCM setup degrades this rather than
> removing it.

That means today's Flutter alert only fires while the app is open and polling — nothing reaches the
member if the app is closed or the phone is asleep.

**The FCM token → backend registration path does not exist yet.** `zkd-flutter/lib/state/world.dart`
has the hook for it, `_registerDeviceOnce(id)`, but its body is empty on purpose:

```dart
void _registerDeviceOnce(String id) {
  if (_registeredFor == id) return;
  _registeredFor = id;
  // Local notifications are the working path today. A remote push token needs
  // FCM, which is not wired yet, so there is nothing to hand over here until
  // that lands — see lib/notify.dart and the plan's FCM section.
}
```

`zkd-flutter/lib/api/client.dart` does have a `registerDevice(token)` method that would `POST` a
token to `/api/devices` — but its own comment flags that this is currently a dead end for an FCM
token specifically:

```dart
/// Hands this device's push token to the server so it can reach the phone
/// when the app is closed. ...
/// NOTE: /api/devices currently validates the token with `isExpoToken` and
/// rejects anything else with 400. An FCM token will be refused until that
/// validation is changed — see the plan's FCM section.
Future<bool> registerDevice(String token) async {
  return await _post('/api/devices', {'token': token}) != null;
}
```

That's confirmed on the backend side too. `zkd-app/app/api/devices/route.ts` accepts a token only
if `isExpoToken(token)` passes, and 400s otherwise:

```ts
if (!isExpoToken(token)) {
  return NextResponse.json({ error: 'not an Expo push token' }, { status: 400 });
}
registerDevice(token, g.passenger.id);
```

`isExpoToken` (`zkd-app/server/notify/push.ts`) matches Expo's own token shape
(`/^Expo(nent)?PushToken\[[^\]]+\]$/`) — because the remote-push channel that's actually built and
working today is for `zkd-android`, the Expo/React Native app, not Flutter. `server/notify/push.ts`
stores tokens keyed by passenger id in a local JSON file and sends through **Expo's push API**
(`https://exp.host/--/api/v2/push/send`), which relays to FCM/APNs on Expo's side — the backend
never talks to Firebase directly, and it has no code path for a raw FCM token today.

So: if Flutter's `registerDevice()` sent a real FCM token to `/api/devices` right now, the backend
would reject it with `400 { error: 'not an Expo push token' }`. Wiring Flutter's remote push means
either (a) adding a second, FCM-shaped branch to `isExpoToken`'s validation and a parallel send path
in `push.ts` that calls the Firebase Admin SDK directly instead of Expo's relay, or (b) putting
Flutter behind Expo's push service the same way `zkd-android` is, which would mean not using a raw
FCM token as the client-server contract at all. Neither is implemented; this is the gap, stated
plainly rather than described as done.
