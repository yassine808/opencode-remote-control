import { useFonts } from '@expo-google-fonts/inter';
import {
  Inter_400Regular,
  Inter_400Regular_Italic,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_600SemiBold_Italic,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
  RobotoMono_400Regular,
  RobotoMono_500Medium,
  RobotoMono_600SemiBold,
} from '@expo-google-fonts/roboto-mono';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StatusBar, useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { ConnectionProvider } from '@/lib/connection';

// Keep the splash up until the faces have loaded — SF-alike text rendering
// with a system-font flash first is the one thing that reads as "not the app".
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const dark = colorScheme === 'dark';
  const c = dark ? Colors.dark : Colors.light;

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

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  const navTheme = {
    ...(dark ? DarkTheme : DefaultTheme),
    colors: {
      ...(dark ? DarkTheme : DefaultTheme).colors,
      background: c.canvas,
      card: c.canvas,
      text: c.ink,
      border: c.hairline,
      primary: c.accent,
    },
  };

  if (!fontsLoaded) return null;

  return (
    <ThemeProvider value={navTheme}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <ConnectionProvider>
        {/* Each screen draws its own header so title, status and actions sit together. */}
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: c.canvas },
          }}
        />
      </ConnectionProvider>
    </ThemeProvider>
  );
}
