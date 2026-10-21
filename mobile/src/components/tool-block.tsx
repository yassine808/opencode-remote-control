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
import { ScrollView, View } from 'react-native';

import { MessageImage } from '@/components/message-image';
import { Terminal } from '@/components/terminal';
import { PopIn, SpinnerRing, Sweep, withAlpha } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { Glyph, PressableScale } from '@/components/ui';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ToolContentBlock, ToolPart } from '@/lib/types';
import { basename } from '@/lib/paths';
import { kindOfTool, type Kind } from '@/lib/tool-meta';

const COLLAPSED_LINES = 12;

function titleFor(part: ToolPart): string {
  const input = part.state.input ?? {};
  const path =
    (typeof input.filePath === 'string' && input.filePath) ||
    (typeof input.path === 'string' && input.path) ||
    (typeof input.pattern === 'string' && input.pattern) ||
    '';
  if (part.name === 'bash' || part.name === 'shell') {
    const d = typeof input.description === 'string' && input.description ? input.description : '';
    const c = typeof input.command === 'string' ? input.command.split('\n')[0] : '';
    return `${part.name} · ${d || c}`.trim();
  }
  return path ? `${part.name} · ${basename(path)}` : part.name;
}

function previewFor(part: ToolPart): string | null {
  const input = part.state.input ?? {};
  if (part.name === 'write' && typeof input.content === 'string' && input.content.length > 0) {
    return input.content;
  }
  return null;
}

/** Image content blocks carried by a tool result. */
function imageBlocks(part: ToolPart): ToolContentBlock[] {
  return (part.state.content ?? []).filter(
    (block) =>
      block.type === 'file' &&
      typeof block.uri === 'string' &&
      typeof block.mime === 'string' &&
      block.mime.startsWith('image/') &&
      (block.uri.startsWith('data:') || block.uri.startsWith('http')),
  );
}

/** The leading status mark: spinner while running, then the outcome. */
function StatusIcon({
  running,
  errored,
  sawRunning,
  kind,
}: Readonly<{ running: boolean; errored: boolean; sawRunning: boolean; kind: Kind }>) {
  const theme = useTheme();
  if (running) {
    return (
      <View style={{ width: 13, height: 13, alignItems: 'center', justifyContent: 'center' }}>
        <SpinnerRing size={13} stroke={1.75} color={theme.clay} duration={900} />
      </View>
    );
  }
  const glyph = errored ? (
    <Glyph name="close-circle-outline" size={13} color={theme.negative} />
  ) : (
    <Glyph set={kind.set} name={kind.icon} size={13} color={theme.inkMuted} />
  );
  return sawRunning ? <PopIn from={0.3}>{glyph}</PopIn> : glyph;
}

function CodePreview({ code }: Readonly<{ code: string }>) {
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

function ToolHeader({
  part,
  kind,
  running,
  errored,
  sawRunning,
  togglable,
  open,
  onToggle,
}: Readonly<{
  part: ToolPart;
  kind: Kind;
  running: boolean;
  errored: boolean;
  sawRunning: boolean;
  togglable: boolean;
  open: boolean;
  onToggle: () => void;
}>) {
  const theme = useTheme();
  const toggle = open ? 'Hide' : 'Show';

  return (
    <PressableScale
      onPress={togglable ? onToggle : undefined}
      disabled={!togglable}
      scaleTo={0.98}
      hitSlop={6}
      accessibilityLabel={togglable ? `${toggle} terminal` : undefined}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        overflow: 'hidden',
        borderRadius: 6,
        alignSelf: 'flex-start',
        maxWidth: '100%',
      }}>
      {running ? <Sweep color={withAlpha(theme.clay, 0.18)} duration={1900} /> : null}
      <StatusIcon running={running} errored={errored} sawRunning={sawRunning} kind={kind} />
      <ThemedText type="callout" style={{ color: theme.inkMuted, flexShrink: 1 }}>
        {titleFor(part)}
      </ThemedText>
      {togglable ? (
        <Glyph name={open ? 'chevron-up' : 'chevron-down'} size={11} color={theme.inkFaint} />
      ) : null}
    </PressableScale>
  );
}

/** Everything under the header row: what ran, what came back. */
function ToolDetails({
  part,
  preview,
  images,
  errorMessage,
  showTerminal,
}: Readonly<{
  part: ToolPart;
  preview: string | null;
  images: ToolContentBlock[];
  errorMessage: string | undefined;
  showTerminal: boolean;
}>) {
  const theme = useTheme();

  return (
    <>
      {showTerminal ? <Terminal part={part} /> : null}

      {images.map((block, i) => (
        <MessageImage
          key={`${part.id}-img${i}`}
          uri={String(block.uri)}
          label={typeof block.name === 'string' ? block.name : undefined}
        />
      ))}

      {errorMessage ? (
        <ThemedText
          type="footnote"
          style={{ color: theme.negative, fontFamily: Fonts.mono, lineHeight: 18 }}>
          {errorMessage}
        </ThemedText>
      ) : null}

      {preview ? <CodePreview code={preview} /> : null}
    </>
  );
}

export function ToolBlock({ part }: Readonly<{ part: ToolPart }>) {
  const kind = kindOfTool(part.name);
  const isShell = part.name === 'bash' || part.name === 'shell';
  const [shellOpen, setShellOpen] = useState(false);
  const status = part.state.status;
  const running = status === 'running' || status === 'pending';
  const errored = status === 'error' || !!part.state.error;

  // A call watched while it ran gets a little "pop" when it lands; history
  // that was already finished on arrival stays still.
  const [sawRunning, setSawRunning] = useState(running);
  if (running && !sawRunning) setSawRunning(true);

  const preview = previewFor(part);
  const errorMessage = errored ? part.state.error?.message : undefined;

  return (
    <View style={{ gap: 6 }}>
      <ToolHeader
        part={part}
        kind={kind}
        running={running}
        errored={errored}
        sawRunning={sawRunning}
        togglable={isShell}
        open={shellOpen}
        onToggle={() => setShellOpen((o) => !o)}
      />
      <ToolDetails
        part={part}
        preview={preview}
        images={imageBlocks(part)}
        errorMessage={errorMessage}
        showTerminal={isShell && shellOpen}
      />
    </View>
  );
}
