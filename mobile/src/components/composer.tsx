/**
 * The prompt bar, following the shape Claude and ChatGPT have converged on:
 * one rounded container holding the text field and a control row.
 *
 * Circular 36pt controls: the earlier inline icons sat under the 44pt touch
 * target and read small against the field. Send is the only accent in the
 * bar — it is the one thing to do here. While the agent runs, the same
 * button becomes Stop. Model and effort live in a muted pill on the control
 * row: switching them is navigation, not the action, so it stays quiet.
 *
 * Attachments ride above the field as quiet chips; the plus that stages them
 * opens first on the control row, at the model pill's height.
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

/** A file staged in the composer, ready to ride the next prompt. */
export interface Attachment {
  name: string;
  mime: string;
  size: number;
  /** `data:<mime>;base64,…` — the one inline form the server accepts. */
  dataUrl: string;
}

/** Compact sizes for attachment chips. */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.max(1, Math.round(bytes))} B`;
}

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
  effortLabel,
  onEffortPress,
  attachments,
  onAttachPress,
  onRemoveAttachment,
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
  /** effort level — pass null/undefined when the model has none and the button hides */
  effortLabel?: string | null;
  onEffortPress?: () => void;
  /** files staged for the next prompt */
  attachments?: Attachment[];
  onAttachPress?: () => void;
  onRemoveAttachment?: (index: number) => void;
}) {
  const theme = useTheme();
  const [height, setHeight] = useState(22);

  const files = attachments ?? [];
  const canSend = value.trim().length > 0 || files.length > 0 || running;
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
      {files.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {files.map((a, i) => (
            <View
              key={`${a.name}-${i}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                height: 24,
                paddingLeft: 8,
                paddingRight: 4,
                borderRadius: 12,
                backgroundColor: theme.surfaceRaised,
                maxWidth: 240,
              }}>
              <Glyph set="mci" name="paperclip" size={11} color={theme.inkFaint} />
              <ThemedText
                type="caption"
                numberOfLines={1}
                style={{ color: theme.inkMuted, flexShrink: 1 }}>
                {a.name}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.inkFaint }}>
                {formatSize(a.size)}
              </ThemedText>
              {onRemoveAttachment ? (
                <PressableScale
                  onPress={() => onRemoveAttachment(i)}
                  hitSlop={8}
                  scaleTo={0.85}
                  accessibilityLabel={`Remove ${a.name}`}
                  style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
                  <Glyph name="close" size={12} color={theme.inkFaint} />
                </PressableScale>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

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
            if (value.trim().length > 0 || files.length > 0) onSend();
          }
        }}
      />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <PressableScale
          onPress={onAttachPress}
          disabled={!onAttachPress || disabled}
          scaleTo={0.9}
          hitSlop={8}
          accessibilityLabel="Attach files"
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.inkWell,
            borderWidth: 1,
            borderColor: theme.inkControl,
            opacity: !onAttachPress || disabled ? 0.45 : 1,
          }}>
          <Glyph name="add" size={17} color={theme.inkMuted} />
        </PressableScale>
        {modelLabel ? (
          <PressableScale
            onPress={onModelPress}
            disabled={!onModelPress}
            scaleTo={0.96}
            accessibilityLabel={`Change model, currently ${modelLabel}`}
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
              maxWidth: effortLabel ? 150 : 220,
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
        {effortLabel ? (
          <PressableScale
            onPress={onEffortPress}
            disabled={!onEffortPress}
            scaleTo={0.96}
            accessibilityLabel={`Change effort, currently ${effortLabel}`}
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
              maxWidth: 110,
            }}>
            <Glyph set="mci" name="speedometer" size={13} color={theme.inkFaint} />
            <ThemedText
              type="caption"
              numberOfLines={1}
              style={{ color: theme.inkMuted, flexShrink: 1, textTransform: 'capitalize' }}>
              {effortLabel}
            </ThemedText>
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
