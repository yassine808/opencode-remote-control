/** End of a reply: a copy button, and how long the whole prompt took. */

import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { PopIn } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { Glyph, PressableScale } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { fmtElapsed } from '@/lib/format';

export function TurnFooter({ text, ms }: Readonly<{ text: string; ms: number | null }>) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <PressableScale
        onPress={() => {
          void Clipboard.setStringAsync(text).then(() => setCopied(true));
        }}
        scaleTo={0.88}
        hitSlop={10}
        accessibilityLabel="Copy reply"
        style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
        {copied ? (
          <PopIn from={0.4}>
            <Glyph name="checkmark" size={16} color={theme.positive} />
          </PopIn>
        ) : (
          <Glyph name="copy-outline" size={16} color={theme.inkMuted} />
        )}
      </PressableScale>
      {ms != null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Glyph name="time-outline" size={13} color={theme.inkFaint} />
          <ThemedText
            type="caption"
            style={{ color: theme.inkFaint, fontVariant: ['tabular-nums'] }}>
            {fmtElapsed(ms)}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}
