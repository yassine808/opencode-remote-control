import {
  Inter_400Regular,
  Inter_400Regular_Italic,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_600SemiBold_Italic,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import {
  RobotoMono_400Regular,
  RobotoMono_500Medium,
  RobotoMono_600SemiBold,
} from '@expo-google-fonts/roboto-mono';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StatusBar } from 'react-native';

import { AppLock } from '@/components/app-lock';
import { useTheme } from '@/hooks/use-theme';
import { ConnectionProvider } from '@/lib/connection';
import { PreferencesProvider, usePreferences } from '@/lib/preferences';

// Keep the splash up until the faces and the stored appearance are ready — an
// SF-alike font flash or a light-to-dark flip is the one thing that reads as
// "not the app".
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  // SF Pro / SF Mono aren't available on Android or the web; Inter and Roboto
  // Mono stand in, closest-free-face to each.
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_400Regular_Italic,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_600SemiBold_Italic,
    Inter_700Bold,
    RobotoMono_400Regular,
    RobotoMono_500Medium,
    RobotoMono_600SemiBold,
  });

  return (
    <PreferencesProvider>
      <AppShell fontsLoaded={fontsLoaded} />
    </PreferencesProvider>
  );
}

function AppShell({ fontsLoaded }: Readonly<{ fontsLoaded: boolean }>) {
  const { ready, scheme } = usePreferences();
  const theme = useTheme();
  const dark = scheme === 'dark';

  useEffect(() => {
    if (fontsLoaded && ready) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, ready]);

  const navTheme = {
    ...(dark ? DarkTheme : DefaultTheme),
    colors: {
      ...(dark ? DarkTheme : DefaultTheme).colors,
      background: theme.canvas,
      card: theme.canvas,
      text: theme.ink,
      border: theme.hairline,
      primary: theme.accent,
    },
  };

  if (!fontsLoaded || !ready) return null;

  return (
    <ThemeProvider value={navTheme}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <ConnectionProvider>
        <AppLock>
          {/* Each screen draws its own header so title, status and actions sit together. */}
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.canvas },
            }}
          />
        </AppLock>
      </ConnectionProvider>
    </ThemeProvider>
  );
}
