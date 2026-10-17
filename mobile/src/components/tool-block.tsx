/**
 * One line per tool call: what ran, where, and how it ended.
 *
 * The transcript row is deliberately quiet — icon, `tool · file`, nothing
 * else. Detail belongs to the permission card (before) and the diff (after),
 * not to a running commentary. The one exception is a write: the content
 * being written is the whole point of the call, so it previews below the
 * row, collapsed to 12 lines.
 */

import { useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Glyph, PressableScale } from '@/components/ui';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ToolPart } from '@/lib/types';
import { basename } from '@/lib/paths';

const COLLAPSED_LINES = 12;

function titleFor(part: ToolPart): string {
  const input = part.state.input ?? {};
  const path =
    (typeof input.filePath === 'string' && input.filePath) ||
    (typeof input.path === 'string' && input.path) ||
    (typeof input.pattern === 'string' && input.pattern) ||
    '';
  return path ? `${part.name} · ${basename(path)}` : part.name;
}

function previewFor(part: ToolPart): string | null {
  const input = part.state.input ?? {};
  if (part.name === 'write' && typeof input.content === 'string' && input.content.length > 0) {
    return input.content;
  }
  return null;
}

function CodePreview({ code }: { code: string }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const lines = code.split('\n');
  const truncated = !expanded && lines.length > COLLAPSED_LINES;
  const shown = truncated ? lines.slice(0, COLLAPSED_LINES).join('\n') : code;

  return (
    <View
      style={{
        backgroundColor: theme.inkWell,
        borderRadius: 12,
        overflow: 'hidden',
      }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 12 }}>
        <ThemedText
          type="code"
          style={{
            color: theme.ink,
            lineHeight: 18,
          }}>
          {shown}
        </ThemedText>
      </ScrollView>
      {truncated ? (
        <PressableScale
          onPress={() => setExpanded(true)}
          scaleTo={0.98}
          style={{
            paddingHorizontal: 14,
            paddingBottom: 10,
            paddingTop: 2,
          }}>
          <ThemedText type="caption" style={{ color: theme.accent }}>
            Show all {lines.length} lines
          </ThemedText>
        </PressableScale>
      ) : null}
    </View>
  );
}

export function ToolBlock({ part }: { part: ToolPart }) {
  const theme = useTheme();

  const status = part.state.status;
  const running = status === 'running' || status === 'pending';
  const errored = status === 'error' || !!part.state.error;

  const preview = previewFor(part);
  const errorMessage = errored ? part.state.error?.message : undefined;

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {running ? (
          <ActivityIndicator size="small" color={theme.inkMuted} style={{ width: 13 }} />
        ) : errored ? (
          <Glyph name="close-circle-outline" size={13} color={theme.negative} />
        ) : (
          <Glyph name="checkmark-circle-outline" size={13} color={theme.inkMuted} />
        )}
        <ThemedText type="callout" style={{ color: theme.inkMuted, flexShrink: 1 }}>
          {titleFor(part)}
        </ThemedText>
      </View>

      {typeof errorMessage === 'string' && errorMessage.length > 0 ? (
        <ThemedText
          type="footnote"
          style={{ color: theme.negative, fontFamily: Fonts.mono, lineHeight: 18 }}>
          {errorMessage}
        </ThemedText>
      ) : null}

      {preview ? <CodePreview code={preview} /> : null}
    </View>
  );
}
