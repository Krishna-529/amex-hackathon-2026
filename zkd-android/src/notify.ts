/**
 * Real Android notifications — a dedicated high-importance channel so the
 * cancellation arrives as a heads-up banner with sound and vibration, plus
 * action buttons that map to the three things a member can do inside the
 * consent window.
 */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

export const CHANNEL_DISRUPTION = 'disruption';
export const CHANNEL_UPDATES = 'updates';
export const CATEGORY = 'zkd.recovery';

// expo-notifications 0.29 (SDK 52) reads `shouldShowAlert` — the newer
// shouldShowBanner/shouldShowList split does not exist here, and without this
// nothing is drawn while the app is in the foreground, which is exactly when
// the cancellation arrives.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    priority: Notifications.AndroidNotificationPriority.MAX,
  }),
});

export async function setupNotifications() {
  if (Platform.OS === 'android') {
    // Disruptions must interrupt — this is the whole point of the product.
    await Notifications.setNotificationChannelAsync(CHANNEL_DISRUPTION, {
      name: 'Flight disruptions',
      description: 'Your flight was cancelled or delayed and we are acting on it',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 320, 160, 320],
      lightColor: '#d9615a',
      sound: 'default',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
    });
    // Confirmations should not. Same product, different urgency.
    await Notifications.setNotificationChannelAsync(CHANNEL_UPDATES, {
      name: 'Booking updates',
      description: 'Confirmations once your trip has been put back together',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#4bab7c',
      sound: 'default',
    });
  }

  await Notifications.setNotificationCategoryAsync(CATEGORY, [
    { identifier: 'approve', buttonTitle: 'Book it now', options: { opensAppToForeground: true } },
    { identifier: 'choose', buttonTitle: 'Other options', options: { opensAppToForeground: true } },
    { identifier: 'stop', buttonTitle: "I'll handle it", options: { opensAppToForeground: true } },
  ]);

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') await Notifications.requestPermissionsAsync();
}

export async function notifyCancelled(flightId: string, flight: string, dep: string, autopilot: boolean) {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: `${flight} has been cancelled`,
      body: autopilot
        ? `Due to depart ${dep}. We're rebooking you now — tap to stop us.`
        : `Due to depart ${dep}. We need your go-ahead before we book anything.`,
      categoryIdentifier: CATEGORY,
      color: '#d9615a',
      priority: Notifications.AndroidNotificationPriority.MAX,
      vibrate: [0, 320, 160, 320],
      data: { screen: 'Recovery', flightId },
    },
    // A bare `null` trigger fires immediately but lands on the fallback
    // channel. `{ channelId }` fires just as immediately and keeps the
    // importance we configured above.
    trigger: { channelId: CHANNEL_DISRUPTION },
  });
}

export async function notifyBooked(flightId: string, code: string, dep: string, owed: string) {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'Rebooked — your trip is back together',
      body: `${code} at ${dep} · hotel and cab moved · ${owed}`,
      color: '#4bab7c',
      data: { screen: 'Recovery', flightId },
    },
    trigger: { channelId: CHANNEL_UPDATES },
  });
}

export async function notifyHandedOver(flightId: string) {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'A person has taken over',
      body: 'Nothing was booked and nothing was charged. Meera has your full context.',
      color: '#2f7ff0',
      data: { screen: 'Recovery', flightId },
    },
    trigger: { channelId: CHANNEL_UPDATES },
  });
}

/**
 * The Expo push token for THIS device, or null.
 *
 * ── Why this exists alongside the local notifications above ────────────────
 *
 * Everything above is a LOCAL notification: the app noticed a change it was
 * already polling for and raised a banner itself. That only works while the app
 * is running. A pre-cancellation warning has to arrive when the phone is in a
 * pocket and the app is closed — that is the entire point of warning someone
 * early — and only a remote push can do that. The server sends it via
 * server/notify/push.ts once this token is registered.
 *
 * NEVER THROWS. Two real reasons it returns null, both survivable:
 *
 *   1. Remote push needs a real device; emulators cannot receive one.
 *   2. `getExpoPushTokenAsync()` needs an EAS projectId to resolve in a
 *      standalone build. `app.json` has no `extra.eas.projectId`, so this
 *      currently works in Expo Go and will fail in a bare APK until one is
 *      added. That is the single likeliest thing to break on demo day.
 *
 * In both cases the local path above still fires whenever the app is open, so a
 * null here degrades the experience rather than removing it.
 */
export async function getPushToken(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;

    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync();
      if (asked.status !== 'granted') return null;
    }

    const token = await Notifications.getExpoPushTokenAsync();
    return token.data ?? null;
  } catch (e) {
    // Loud in the log, silent to the member — they still get local banners.
    console.warn('[notify] no push token; remote alerts disabled for this device:', e);
    return null;
  }
}
