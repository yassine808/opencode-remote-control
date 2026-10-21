import { useColorScheme as useSystemColorScheme } from 'react-native';

import { usePreferredScheme } from '@/lib/preferences';

/**
 * The scheme the deck should paint. Inside the preferences provider this is
 * the in-app choice (falling back to the phone when set to system); outside it,
 * the system value keeps standalone use of the hook working.
 */
export function useColorScheme() {
  const preferred = usePreferredScheme();
  const system = useSystemColorScheme();
  return preferred ?? system;
}
