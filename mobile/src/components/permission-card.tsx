/**
 * "The agent wants to do X — allow?"
 *
 * A sheet rather than an alert, deliberately: the choice relates to an
 * intentional action, and the card carries content the user has to read —
 * the exact command, its scope, what "always" would grant.
 *
 * The card varies with risk. A git status and an rm -rf must not look the
 * same: an identical card every time optimises for habituation, and varying
 * presentation by risk is the empirically supported counter.
 */

import { useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button, Glyph } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import type { PermissionDecision, PermissionRequest } from '@/lib/types';

/**
 * Heuristic risk read, mirroring the companion's: destructive shell,
 * anything touching the wider system, or an edit outside what was asked.
 */
const DANGER = [
  /\brm\s+(?:-(?=[a-z]*[rf])[a-z]+\s+)+/i,
  /\bsudo\b/i,
  /\b(mkfs|dd|shutdown|reboot|diskpart|format)\b/i,
  /\bchmod\s+-R\b/i,
  /\bchown\s+-R\b/i,
  /\bgit\s+push\s+(-f|--force)/i,
  /\bkill(all)?\s+-9\b/i,
  /\bcurl\b.*\|\s*(sh|bash)\b/i,
  /(>\s*\/dev\/|>\s*[A-Z]:\\)/i,
  /\bmv\s+\S+\s+\/(etc|usr|bin|sbin)\b/i,
];

function isHighRisk(request: PermissionRequest): boolean {
  if (request.action === 'external_directory') return true;
  return request.resources.some((r) => DANGER.some((re) => re.test(r)));
}

function titleFor(request: PermissionRequest, high: boolean): string {
  switch (request.action) {
    case 'bash':
      return high ? 'Run a risky command?' : 'Run a command?';
    case 'edit':
      return 'Edit files?';
    case 'write':
      return 'Write files?';
    case 'patch':
      return 'Apply a patch?';
    case 'read':
      return 'Read a file?';
    case 'external_directory':
      return 'Reach outside the project?';
    case 'webfetch':
    case 'websearch':
      return 'Access the network?';
    default:
      return `${request.action.charAt(0).toUpperCase()}${request.action.slice(1)}?`;
  }
}

export function PermissionCard({
  request,
  index,
  total,
  busy,
  onDecide,
}: Readonly<{
  request: PermissionRequest | null;
  index: number;
  total: number;
  busy: boolean;
  onDecide: (decision: PermissionDecision) => void;
}>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [confirmAlways, setConfirmAlways] = useState(false);

  if (!request) return null;

  const high = isHighRisk(request);
  const queued = Math.max(0, total - index - 1);
  const scope = request.save?.length ? request.save : request.resources;

  const close = () => setConfirmAlways(false);
  const btn = { flex: 1, paddingHorizontal: 8 } as const; // all buttons: same size

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: theme.canvas,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: 16 + insets.bottom,
            gap: 14,
          }}>
          {/* title */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Glyph
              name={high ? 'warning' : 'shield-checkmark-outline'}
              size={18}
              color={high ? theme.caution : theme.inkMuted}
            />
            <ThemedText type="headline" style={{ color: theme.ink, flex: 1 }} numberOfLines={1}>
              {titleFor(request, high)}
            </ThemedText>
            {queued > 0 ? (
              <ThemedText type="caption" style={{ color: theme.inkFaint }}>
                +{queued} waiting
              </ThemedText>
            ) : null}
          </View>

          {confirmAlways ? (
            <ThemedText type="callout" style={{ color: theme.inkMuted }}>
              Allow every {request.action} like this until OpenCode restarts?
            </ThemedText>
          ) : (
            <>
              {/* the exact ask — mono, never wrapped */}
              <View
                style={{
                  backgroundColor: theme.inkWell,
                  borderRadius: 10,
                  borderLeftWidth: 3,
                  borderLeftColor: high ? theme.caution : theme.clay,
                  overflow: 'hidden',
                }}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10 }}>
                  <ThemedText type="code" style={{ color: theme.ink, fontSize: 14, lineHeight: 20 }}>
                    {request.resources.join('\n')}
                  </ThemedText>
                </ScrollView>
              </View>
              {!high ? (
                <ThemedText type="caption" style={{ color: theme.inkFaint }} numberOfLines={2}>
                  Always: {scope.join(', ')}
                </ThemedText>
              ) : null}
            </>
          )}

          {/* actions — one row, equal buttons */}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {!confirmAlways ? (
              <>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onPress={() => onDecide('reject')}
                  style={btn}>
                  Reject
                </Button>
                {!high ? (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onPress={() => setConfirmAlways(true)}
                    style={btn}>
                    Always
                  </Button>
                ) : null}
                <Button
                  variant="primary"
                  busy={busy}
                  disabled={busy}
                  onPress={() => onDecide('once')}
                  style={btn}>
                  Allow once
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" disabled={busy} onPress={close} style={btn}>
                  Back
                </Button>
                <Button
                  variant="primary"
                  busy={busy}
                  disabled={busy}
                  onPress={() => onDecide('always')}
                  style={btn}>
                  Allow always
                </Button>
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}
