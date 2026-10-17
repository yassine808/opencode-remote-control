import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar, useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { ConnectionProvider } from '@/lib/connection';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const dark = colorScheme === 'dark';
  const c = dark ? Colors.dark : Colors.light;

  const navTheme = {
    ...(dark ? DarkTheme : DefaultTheme),
    colors: {
      ...(dark ? DarkTheme : DefaultTheme).colors,
      background: c.background,
      card: c.backgroundElement,
      text: c.text,
      border: c.border,
      primary: c.accent,
    },
  };

  return (
    <ThemeProvider value={navTheme}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} backgroundColor={c.background} />
      <ConnectionProvider>
        {/* Each screen draws its own header so title, status and actions sit together. */}
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: c.background },
            animation: 'slide_from_right',
          }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="setup" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="session/[id]" />
        </Stack>
      </ConnectionProvider>
    </ThemeProvider>
  );
}
