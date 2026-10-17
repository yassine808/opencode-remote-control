import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { ConnectionProvider } from '@/lib/connection';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <ConnectionProvider>
        <Stack>
          <Stack.Screen name="index" options={{ title: 'Sessions' }} />
          <Stack.Screen name="setup" options={{ title: 'Pair with PC', presentation: 'modal' }} />
          <Stack.Screen name="session/[id]" options={{ title: 'Session' }} />
        </Stack>
      </ConnectionProvider>
    </ThemeProvider>
  );
}
