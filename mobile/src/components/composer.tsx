/**
 * The prompt bar, following the shape Claude and ChatGPT have converged on:
 * one rounded container holding the text field and a control row.
 *
 * Circular 36pt controls: the earlier inline icons sat under the 44pt touch
 * target and read small against the field. Send is the only accent in the
 * bar — it is the one thing to do here. While the agent runs, the same
 * button becomes Stop. Model and effort live in a muted pill on the control
 * row: switching them is navigation, not the action, so it stays quiet.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Glyph, PressableScale } from '@/components/ui';
import { Fonts, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const MAX_LINES = 6;

export function Composer({
  value,
  onChangeText,
  running,
  busy,
  onSend,
  onStop,
  disabled,
  modelLabel,
  onModelPress,
}: {
  value: string;
  onChangeText: (text: string) => void;
  running: boolean;
  /** a send is in flight (button shows a spinner) */
  busy?: boolean;
  onSend: () => void;
  onStop: () => void;
  disabled?: boolean;
  /** the session's current model (and effort) — rendered as the control-row pill */
  modelLabel?: string | null;
  onModelPress?: () => void;
}) {
  const theme = useTheme();
  const [height, setHeight] = useState(22);

  const canSend = value.trim().length > 0 || running;
  const primary = running; // running → the button is Stop

  return (
    <View
      style={{
        marginHorizontal: 10,
        marginBottom: 8,
        backgroundColor: theme.inkWell,
        borderWidth: 1,
        borderColor: theme.inkControl,
        borderRadius: Radius.composer,
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 8,
      }}>
      <TextInput
        multiline
        value={value}
        onChangeText={onChangeText}
        onContentSizeChange={(e) => {
          const next = Math.min(
            e.nativeEvent.contentSize.height,
            MAX_LINES * 22,
          );
          setHeight(Math.max(22, next));
        }}
        placeholder="Ask the agent…"
        placeholderTextColor={theme.inkFaint}
        editable={!disabled}
        style={{
          fontFamily: Fonts.regular,
          fontSize: 17,
          lineHeight: 22,
          color: theme.ink,
          minHeight: 22,
          height,
          padding: 0,
          margin: 0,
          textAlignVertical: 'top',
        }}
        onKeyPress={(e: any) => {
          if (
            Platform.OS === 'web' &&
            e.nativeEvent?.key === 'Enter' &&
            !e.nativeEvent?.shiftKey
          ) {
            e.preventDefault?.();
            if (running) return;
            if (value.trim().length > 0) onSend();
          }
        }}
      />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {modelLabel ? (
          <PressableScale
            onPress={onModelPress}
            disabled={!onModelPress}
            scaleTo={0.96}
            accessibilityLabel={`Change model and effort, currently ${modelLabel}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              height: 28,
              paddingHorizontal: 10,
              borderRadius: 14,
              backgroundColor: theme.inkWell,
              borderWidth: 1,
              borderColor: theme.inkControl,
              maxWidth: 220,
            }}>
            <ThemedText
              type="caption"
              numberOfLines={1}
              style={{ color: theme.inkMuted, flexShrink: 1 }}>
              {modelLabel}
            </ThemedText>
            <Glyph name="chevron-down" size={11} color={theme.inkFaint} />
          </PressableScale>
        ) : null}
        <View style={{ flex: 1 }} />
        <PressableScale
          onPress={primary ? onStop : canSend && !busy ? onSend : undefined}
          disabled={!canSend || (busy && !primary)}
          scaleTo={0.92}
          accessibilityLabel={primary ? 'Stop' : 'Send'}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: canSend ? theme.accent : theme.inkControl,
          }}>
          {busy && !primary ? (
            <ActivityIndicator size="small" color={theme.onAccent} />
          ) : primary ? (
            <Ionicons name="stop" size={15} color={canSend ? theme.onAccent : theme.inkMuted} />
          ) : (
            <Ionicons
              name="arrow-up"
              size={17}
              color={canSend ? theme.onAccent : theme.inkMuted}
            />
          )}
        </PressableScale>
      </View>
    </View>
  );
}
