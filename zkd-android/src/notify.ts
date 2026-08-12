/**
 * Real Android notifications — a dedicated high-importance channel so the
 * cancellation arrives as a heads-up banner with sound and vibration, plus
 * action buttons that map to the three things a member can do inside the
 * consent window.
 */
import * as Notifications from 'expo-notifications';
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

export async function notifyCancelled(flight: string, dep: string, autopilot: boolean) {
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
      data: { screen: 'Recovery' },
    },
    // A bare `null` trigger fires immediately but lands on the fallback
    // channel. `{ channelId }` fires just as immediately and keeps the
    // importance we configured above.
    trigger: { channelId: CHANNEL_DISRUPTION },
  });
}

export async function notifyBooked(code: string, dep: string, owed: string) {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'Rebooked — your trip is back together',
      body: `${code} at ${dep} · hotel and cab moved · ${owed}`,
      color: '#4bab7c',
      data: { screen: 'Recovery' },
    },
    trigger: { channelId: CHANNEL_UPDATES },
  });
}

export async function notifyHandedOver() {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'A person has taken over',
      body: 'Nothing was booked and nothing was charged. Meera has your full context.',
      color: '#2f7ff0',
      data: { screen: 'Recovery' },
    },
    trigger: { channelId: CHANNEL_UPDATES },
  });
}
