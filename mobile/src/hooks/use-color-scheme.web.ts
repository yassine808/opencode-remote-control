import { useSyncExternalStore } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

import { usePreferredScheme } from '@/lib/preferences';

// Never emits — the point is the snapshot difference between server and client.
const emptySubscribe = () => () => {};

/**
 * To support static rendering, this value needs to be re-calculated on the
 * client side for web. `useSyncExternalStore` flips the snapshot from false
 * (server / hydration) to true (client) without a state-sync effect.
 *
 * After hydration this follows the same rule as native: the in-app appearance
 * choice wins, and "system" falls back to the device scheme.
 */
export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const preferred = usePreferredScheme();
  const system = useSystemColorScheme();

  return hasHydrated ? (preferred ?? system) : 'light';
}
