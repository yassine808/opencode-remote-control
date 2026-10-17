import * as Clipboard from 'expo-clipboard';
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Block =
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'para'; text: string };

/** Minimal markdown: fenced code, headings, bullets, `inline code`, **bold**. Streams safely (open fences render as code). */
function parse(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'para', text: para.join('\n') });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*```(\S*)\s*$/);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      blocks.push({ kind: 'code', lang: fence[1] ?? '', text: body.join('\n') });
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', text: heading[1] });
      continue;
    }
    const bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (bullet) {
      flush();
      blocks.push({ kind: 'bullet', text: bullet[1] });
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

function Inline({ text, bold }: { text: string; bold?: boolean }) {
  const theme = useTheme();
  const parts: ReactNode[] = [];
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) {
      parts.push(
        <Text key={k++} style={[styles.inlineCode, { backgroundColor: theme.code, color: theme.text }]}>
          {` ${tok.slice(1, -1)} `}
        </Text>,
      );
    } else {
      parts.push(
        <Text key={k++} style={styles.bold}>
          {tok.slice(2, -2)}
        </Text>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <ThemedText style={bold ? styles.headingText : undefined}>{parts}</ThemedText>;
}

export function CodeBlock({ text, lang }: { text: string; lang?: string }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const copy = async () => {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  };
  return (
    <View style={[styles.codeWrap, { backgroundColor: theme.code, borderColor: theme.border }]}>
      <View style={styles.codeBar}>
        <ThemedText type="caption" themeColor="textTertiary">
          {lang || 'text'}
        </ThemedText>
        <PressableScale onPress={() => void copy()} hitSlop={10} scaleTo={0.92} accessibilityLabel="Copy code">
          <ThemedText type="caption" themeColor={copied ? 'success' : 'textSecondary'} style={{ fontWeight: '600' }}>
            {copied ? 'Copied' : 'Copy'}
          </ThemedText>
        </PressableScale>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeScroll}>
        <ThemedText type="code" selectable style={styles.codeText}>
          {text}
        </ThemedText>
      </ScrollView>
    </View>
  );
}

export const RichText = memo(function RichText({ text }: { text: string }) {
  const blocks = parse(text);
  return (
    <View style={styles.root}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'code':
            return <CodeBlock key={i} text={b.text} lang={b.lang} />;
          case 'heading':
            return <Inline key={i} text={b.text} bold />;
          case 'bullet':
            return (
              <View key={i} style={styles.bulletRow}>
                <ThemedText themeColor="textTertiary" style={styles.bulletDot}>
                  •
                </ThemedText>
                <View style={styles.bulletBody}>
                  <Inline text={b.text} />
                </View>
              </View>
            );
          default:
            return <Inline key={i} text={b.text} />;
        }
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { gap: Spacing.two + 2 },
  bold: { fontWeight: '700' },
  headingText: { fontWeight: '700', fontSize: 17 },
  inlineCode: { fontFamily: Fonts.mono, fontSize: 14 },
  bulletRow: { flexDirection: 'row', gap: Spacing.two, paddingRight: Spacing.two },
  bulletDot: { width: 12, textAlign: 'center' },
  bulletBody: { flex: 1 },
  codeWrap: { borderRadius: Radius.medium, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  codeBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  codeScroll: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three, paddingTop: Spacing.one },
  codeText: { fontSize: 13, lineHeight: 19 },
});
