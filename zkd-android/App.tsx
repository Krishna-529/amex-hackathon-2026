import React, { useEffect, useRef } from 'react';
import { LogBox, StatusBar, View } from 'react-native';
import { NavigationContainer, DefaultTheme, type NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';

import { C } from './src/theme';
import { Mesh, TopBar } from './src/ui';
import { WorldProvider } from './src/world';
import { setupNotifications } from './src/notify';
import FlightsScreen from './src/screens/FlightsScreen';
import FlightDetailScreen from './src/screens/FlightDetailScreen';
import RecoveryScreen from './src/screens/RecoveryScreen';
import ProfileScreen from './src/screens/ProfileScreen';

// The dev-build warning banner sits over the UI in screenshots and demos.
// Nothing here is a real error — expo-notifications warns about remote push
// on a bare build, which this deliberately does not use.
LogBox.ignoreAllLogs();

const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  dark: true,
  colors: { ...DefaultTheme.colors, background: 'transparent', card: C.bg, text: C.text, border: C.edge },
};

export default function App() {
  const nav = useRef<NavigationContainerRef<any>>(null);

  useEffect(() => {
    setupNotifications().catch(() => {});
    // Every action button and the notification body itself points at the same
    // place — the recovery the member is being asked about.
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const screen = (r.notification.request.content.data as any)?.screen;
      if (screen === 'Recovery') nav.current?.navigate('Recovery' as never);
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
        <Mesh />
        <WorldProvider>
          <NavigationContainer ref={nav} theme={navTheme}>
            <Stack.Navigator
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: 'transparent' },
                animation: 'slide_from_right',
              }}
            >
              <Stack.Screen name="Flights">
                {(props) => (
                  <Screen {...props} first>
                    <FlightsScreen {...props} />
                  </Screen>
                )}
              </Stack.Screen>
              <Stack.Screen name="FlightDetail">
                {(props) => (
                  <Screen {...props}>
                    <FlightDetailScreen {...props} />
                  </Screen>
                )}
              </Stack.Screen>
              <Stack.Screen name="Recovery">
                {(props) => (
                  <Screen {...props}>
                    <RecoveryScreen {...props} />
                  </Screen>
                )}
              </Stack.Screen>
              <Stack.Screen name="Profile">
                {(props) => (
                  <Screen {...props}>
                    <ProfileScreen />
                  </Screen>
                )}
              </Stack.Screen>
            </Stack.Navigator>
          </NavigationContainer>
        </WorldProvider>
      </View>
    </SafeAreaProvider>
  );
}

/** One app bar for every route, so the brand never disappears mid-journey. */
function Screen({
  navigation,
  first,
  children,
}: {
  navigation: any;
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={{ flex: 1 }}>
      <TopBar
        onBack={first ? undefined : () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Flights'))}
        onProfile={() => navigation.navigate('Profile')}
      />
      {children}
    </View>
  );
}
