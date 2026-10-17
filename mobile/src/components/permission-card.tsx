import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, StatusDot, useReduceMotion } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { PermissionDecision, PermissionRequest } from '@/lib/types';

const NATIVE = Platform.OS !== 'web';

/**
 * Docked above the composer so the decision is always one thumb-reach away.
 * Springs up when a request arrives — the one interruption the UI is allowed to make.
 */
export function PermissionCard({
  request,
  index,
  total,
  busy,
  onDecide,
}: {
  request: PermissionRequest;
  index: number;
  total: number;
  busy: boolean;
  onDecide: (decision: PermissionDecision) => void;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current;

  useEffect(() => {
    if (reduce) return;
    v.setValue(0);
    Animated.spring(v, { toValue: 1, useNativeDriver: NATIVE, speed: 14, bounciness: 7 }).start();
  }, [request.id, reduce, v]);

  const resources = request.resources ?? [];
  const shown = resources.slice(0, 2);

  return (
    <Animated.View
      accessibilityLiveRegion="assertive"
      style={[
        styles.card,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.warnSolid,
          opacity: v.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }],
        },
      ]}>
      <View style={styles.head}>
        <StatusDot color={theme.warnSolid} pulse size={8} />
        <ThemedText type="smallBold" style={styles.title}>
          Approval needed
        </ThemedText>
        {total > 1 ? (
          <ThemedText type="caption" themeColor="textSecondary">
            {index + 1} of {total}
          </ThemedText>
        ) : null}
      </View>

      <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
        {request.message || `OpenCode wants to run: ${request.action}`}
      </ThemedText>

      {shown.length > 0 && (
        <View style={styles.resources}>
          {shown.map((r) => (
            <View key={r} style={[styles.resource, { backgroundColor: theme.code, borderColor: theme.border }]}>
              <ThemedText type="code" numberOfLines={1}>
                {r}
              </ThemedText>
            </View>
          ))}
          {resources.length > shown.length ? (
            <ThemedText type="caption" themeColor="textSecondary">
              +{resources.length - shown.length} more
            </ThemedText>
          ) : null}
        </View>
      )}

      <View style={styles.actions}>
        <Button label="Reject" variant="danger" disabled={busy} onPress={() => onDecide('reject')} style={styles.flex} />
        <Button label="Always" disabled={busy} onPress={() => onDecide('always')} style={styles.flex} />
        <Button label="Allow once" variant="primary" disabled={busy} onPress={() => onDecide('once')} style={styles.flexWide} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two + 2,
    borderRadius: Radius.large,
    borderWidth: 1.5,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  title: { flex: 1 },
  resources: { gap: 6 },
  resource: { borderRadius: Radius.small, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 6 },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: 2 },
  flex: { flex: 1, minWidth: 0 },
  flexWide: { flex: 1.5, minWidth: 0 },
});
