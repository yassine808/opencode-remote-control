/**
 * Markdown, rendered the way their MarkdownText.swift renders it.
 *
 * A block pass and an inline pass, and nothing else. The rhythm is the
 * design: three extra points of leading inside prose, eleven between
 * blocks, five between list items, fourteen per indent level. Code never
 * wraps — it scrolls, because a wrapped line of code is a lie about where
 * the line ends.
 *
 * Unknown languages and partial fences render as plain code — that's the
 * documented fallback, and it is also what streaming requires: a fence
 * that has opened but not closed is still a code block.
 */

import { useMemo, type ReactNode } from 'react';
import {
  Linking,
  ScrollView,
  type StyleProp,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';

import { Fonts, ProseLine, Space, type Palette, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// ---------- block model ----------

type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'code'; code: string; lang: string }
  | { kind: 'list'; ordered: boolean; items: { depth: number; marker: string; text: string }[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] };

const FENCE = /^```([\w+#.-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?[\s|:-]*-[\s|:-]*\|?\s*$/;

function splitCells(line: string): string[] {
  const cells = line.split('|').map((c) => c.trim());
  if (cells.length > 0 && cells[0] === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // closing fence
      blocks.push({ kind: 'code', code: body.join('\n'), lang: (fence[1] || '').toLowerCase() });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      const items: { depth: number; marker: string; text: string }[] = [];
      let ordered = false;
      while (i < lines.length) {
        const b = lines[i].match(BULLET);
        const o = lines[i].match(ORDERED);
        if (b) {
          items.push({ depth: Math.floor(b[1].length / 2), marker: '•', text: b[2] });
        } else if (o) {
          ordered = true;
          items.push({ depth: Math.floor(o[1].length / 2), marker: `${o[2]}.`, text: o[3] });
        } else {
          break;
        }
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(lines[i].match(QUOTE)![1]);
        i++;
      }
      blocks.push({ kind: 'quote', lines: body });
      continue;
    }

    const next = lines[i + 1];
    if (line.includes('|') && next != null && next.includes('-') && TABLE_SEP.test(next)) {
      const header = splitCells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitCells(lines[i]));
        i++;
      }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    // paragraph — runs until a blank line or anything that starts a block
    const body: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (
        l.trim() === '' ||
        FENCE.test(l) ||
        HEADING.test(l) ||
        BULLET.test(l) ||
        ORDERED.test(l) ||
        QUOTE.test(l)
      ) {
        break;
      }
      body.push(l);
      i++;
    }
    blocks.push({ kind: 'paragraph', lines: body });
  }

  return blocks;
}

// ---------- CLI colours ----------

/** The palette the opencode terminal UI paints markdown with. */
interface Cli {
  heading: string;
  bold: string;
  italic: string;
  code: string;
  link: string;
  bullet: string;
  quote: string;
  strike: string;
  // syntax
  kw: string;
  str: string;
  num: string;
  com: string;
  fn: string;
  type: string;
  add: string;
  del: string;
  hunk: string;
}

function cliColors(theme: Palette): Cli {
  const dark = theme.scheme === 'dark';
  return dark
    ? {
        heading: '#9D7CD8', bold: '#F5A742', italic: '#E5C07B', code: '#7FD88F',
        link: '#5C9CF5', bullet: '#5C9CF5', quote: '#E5C07B', strike: '#808080',
        kw: '#C678DD', str: '#98C379', num: '#D19A66', com: '#6B7280',
        fn: '#61AFEF', type: '#E5C07B', add: '#7FD88F', del: '#F07178', hunk: '#56B6C2',
      }
    : {
        heading: '#7C3AED', bold: '#B45309', italic: '#A16207', code: '#15803D',
        link: '#1D4ED8', bullet: '#1D4ED8', quote: '#A16207', strike: '#6B7280',
        kw: '#9333EA', str: '#15803D', num: '#B45309', com: '#6B7280',
        fn: '#1D4ED8', type: '#A16207', add: '#15803D', del: '#B91C1C', hunk: '#0E7490',
      };
}

const KEYWORDS = new Set(
  (
    'abstract as async await break case catch class const continue declare def default del defer do elif else enum ' +
    'except export extends false final finally fn for from func function go if impl implements import in interface is ' +
    'lambda let loop match mod module mut namespace new nil none null of or package pass private protected pub public ' +
    'raise readonly return self static struct super switch then this throw trait true try type typeof use val var ' +
    'void while with yield and not echo exit fi done esac select set unset export local'
  ).split(' '),
);

const HASH_COMMENT = new Set(['sh', 'bash', 'zsh', 'shell', 'console', 'py', 'python', 'rb', 'ruby', 'yaml', 'yml', 'toml', 'dockerfile', 'makefile', 'ini', 'conf', 'r', 'pl', 'perl', 'ps1', 'powershell', '']);
const DASH_COMMENT = new Set(['sql', 'lua', 'hs', 'haskell']);

function highlight(code: string, lang: string, c: Cli, base: string): ReactNode[] {
  const out: ReactNode[] = [];
  const comment = DASH_COMMENT.has(lang)
    ? '--[^\n]*'
    : HASH_COMMENT.has(lang)
      ? '#[^\n]*|//[^\n]*'
      : '\\/\\/[^\n]*';
  const re = new RegExp(
    `(\\/\\*[\\s\\S]*?\\*\\/|${comment})` + // 1 comment
      `|("(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*'|` + '`(?:\\\\.|[^`\\\\])*`)' + // 2 string
      `|(\\b0x[0-9a-fA-F]+\\b|\\b\\d+(?:\\.\\d+)?\\b)` + // 3 number
      `|(\\b[A-Za-z_][A-Za-z0-9_]*\\b)(?=(\\())?`, // 4 word, 5 call
    'g',
  );
  let last = 0;
  let k = 0;
  const push = (text: string, color: string) =>
    out.push(
      <Text key={k++} style={{ color }}>
        {text}
      </Text>,
    );
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (m.index > last) push(code.slice(last, m.index), base);
    const t = m[0];
    if (m[1] != null) push(t, c.com);
    else if (m[2] != null) push(t, c.str);
    else if (m[3] != null) push(t, c.num);
    else {
      const w = m[4];
      if (KEYWORDS.has(w)) push(t, c.kw);
      else if (m[5]) push(t, c.fn);
      else if (/^[A-Z][A-Za-z0-9_]*$/.test(w)) push(t, c.type);
      else push(t, base);
    }
    last = m.index + t.length;
    if (t.length === 0) re.lastIndex++;
  }
  if (last < code.length) push(code.slice(last), base);
  return out;
}

function looksLikeDiff(code: string, lang: string): boolean {
  if (lang === 'diff' || lang === 'patch') return true;
  const lines = code.split('\n').filter((l) => l.trim());
  return (
    lines.length > 2 &&
    lines.some((l) => /^@@ .* @@/.test(l)) &&
    lines.every((l) => /^([+\- @\\]|diff |index |---|\+\+\+)/.test(l))
  );
}

function renderDiff(code: string, c: Cli, base: string): ReactNode[] {
  return code.split('\n').map((line, i, all) => {
    let color = base;
    let bg: string | undefined;
    if (/^(\+\+\+|---|diff |index )/.test(line)) color = c.hunk;
    else if (line.startsWith('@@')) color = c.hunk;
    else if (line.startsWith('+')) {
      color = c.add;
      bg = withAlpha(c.add, 0.12);
    } else if (line.startsWith('-')) {
      color = c.del;
      bg = withAlpha(c.del, 0.12);
    }
    return (
      <Text key={i} style={{ color, backgroundColor: bg }}>
        {line}
        {i < all.length - 1 ? '\n' : ''}
      </Text>
    );
  });
}

function withAlpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ---------- inline model ----------

const INLINE =
  /(`[^`\n]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~]+~~)/g;

function renderInline(
  text: string,
  theme: Palette,
  keyPrefix: string,
  bold = false,
): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;

  const push = (node: ReactNode) => out.push(<Text key={`${keyPrefix}-${key++}`}>{node}</Text>);

  // A fresh regex per call: renderInline recurses (bold inside bold, link
  // labels), and a shared /g regex would hand the outer loop the inner
  // loop's lastIndex.
  const re = new RegExp(INLINE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    if (m.index > last) push(text.slice(last, m.index));
    const token = m[0];

    if (token.startsWith('`')) {
      push(
        <Text style={{ fontFamily: Fonts.mono, fontSize: 15, color: cliColors(theme).code }}>
          {token.slice(1, -1)}
        </Text>,
      );
    } else if (token.startsWith('[')) {
      const link = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (link) {
        const url = link[2];
        push(
          <Text
            style={{ color: cliColors(theme).link, textDecorationLine: 'underline' }}
            onPress={() => {
              Linking.openURL(url).catch(() => {});
            }}>
            {renderInline(link[1], theme, `${keyPrefix}-l${key}`, bold)}
          </Text>,
        );
      } else {
        push(token);
      }
    } else if (token.startsWith('**')) {
      push(
        <Text style={{ fontFamily: Fonts.semibold, color: cliColors(theme).bold }}>
          {renderInline(token.slice(2, -2), theme, `${keyPrefix}-b${key}`, true)}
        </Text>,
      );
    } else if (token.startsWith('~~')) {
      push(
        <Text style={{ textDecorationLine: 'line-through', color: cliColors(theme).strike }}>
          {renderInline(token.slice(2, -2), theme, `${keyPrefix}-s${key}`, bold)}
        </Text>,
      );
    } else {
      // *italic* or _italic_
      push(
        <Text
          style={{
            fontFamily: bold ? Fonts.semiboldItalic : Fonts.italic,
            color: cliColors(theme).italic,
          }}>
          {renderInline(token.slice(1, -1), theme, `${keyPrefix}-i${key}`, bold)}
        </Text>,
      );
    }

    last = m.index + token.length;
  }

  if (last < text.length) push(text.slice(last));
  return out;
}

// ---------- rendering ----------

const bodyText: TextStyle = {
  fontFamily: Fonts.regular,
  fontSize: 17,
  lineHeight: ProseLine.body,
};

function headingStyle(level: number): TextStyle {
  if (level <= 1) return { fontFamily: Fonts.semibold, fontSize: 20, lineHeight: 26 };
  if (level === 2) return { fontFamily: Fonts.semibold, fontSize: 17, lineHeight: 22 };
  if (level === 3) return { fontFamily: Fonts.semibold, fontSize: 15, lineHeight: 20 };
  return { fontFamily: Fonts.semibold, fontSize: 13, lineHeight: 18 };
}

/** A code well: mono, never wrapped, scrolls sideways. */
export function CodeBlock({
  code,
  lang = '',
  style,
}: {
  code: string;
  lang?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const c = cliColors(theme);
  const body = useMemo(
    () =>
      looksLikeDiff(code, lang)
        ? renderDiff(code, c, theme.ink)
        : highlight(code, lang, c, theme.ink),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [code, lang, theme.scheme],
  );
  return (
    <View style={[{ borderRadius: 12, backgroundColor: theme.inkWell, overflow: 'hidden' }, style]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 12 }}>
        <Text
          style={{
            fontFamily: Fonts.mono,
            fontSize: 15,
            lineHeight: 21,
            color: theme.ink,
          }}>
          {body}
        </Text>
      </ScrollView>
    </View>
  );
}

function renderBlock(block: Block, theme: Palette, keyPrefix: string): ReactNode {
  switch (block.kind) {
    case 'paragraph':
      return (
        <Text style={[bodyText, { color: theme.ink }]}>
          {renderInline(block.lines.join('\n'), theme, `${keyPrefix}-p`)}
        </Text>
      );

    case 'heading':
      return (
        <Text style={[headingStyle(block.level), { color: cliColors(theme).heading }]}>
          {renderInline(block.text, theme, `${keyPrefix}-h`)}
        </Text>
      );

    case 'code':
      return <CodeBlock code={block.code} lang={block.lang} />;

    case 'list':
      return (
        <View style={{ gap: Space.itemSpacing }}>
          {block.items.map((item, idx) => (
            <View
              key={`${keyPrefix}-li${idx}`}
              style={{ flexDirection: 'row', paddingLeft: item.depth * Space.indent }}>
              <Text
                style={[
                  bodyText,
                  {
                    color: cliColors(theme).bullet,
                    width: block.ordered ? undefined : 18,
                    marginRight: block.ordered ? 6 : 0,
                  },
                ]}>
                {item.marker}
              </Text>
              <Text style={[bodyText, { color: theme.ink, flex: 1 }]}>
                {renderInline(item.text, theme, `${keyPrefix}-lit${idx}`)}
              </Text>
            </View>
          ))}
        </View>
      );

    case 'quote':
      return (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ width: 2, borderRadius: 1, backgroundColor: cliColors(theme).quote }} />
          <Text
            style={[
              bodyText,
              { fontFamily: Fonts.italic, color: cliColors(theme).quote, flex: 1 },
            ]}>
            {renderInline(block.lines.join('\n'), theme, `${keyPrefix}-q`)}
          </Text>
        </View>
      );

    case 'table':
      return (
        <View style={{ borderRadius: 12, backgroundColor: theme.inkWell, overflow: 'hidden' }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ paddingHorizontal: 6, paddingVertical: 6 }}>
              <View
                style={{
                  flexDirection: 'row',
                  borderBottomWidth: 1,
                  borderBottomColor: theme.hairline,
                }}>
                {block.header.map((cell, idx) => (
                  <Text
                    key={`${keyPrefix}-th${idx}`}
                    style={{
                      fontFamily: Fonts.semibold,
                      fontSize: 15,
                      lineHeight: 20,
                      color: theme.ink,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                    }}>
                    {renderInline(cell, theme, `${keyPrefix}-thc${idx}`)}
                  </Text>
                ))}
              </View>
              {block.rows.map((row, r) => (
                <View key={`${keyPrefix}-tr${r}`} style={{ flexDirection: 'row' }}>
                  {row.map((cell, c) => (
                    <Text
                      key={`${keyPrefix}-td${r}-${c}`}
                      style={{
                        fontFamily: Fonts.regular,
                        fontSize: 15,
                        lineHeight: 20,
                        color: theme.ink,
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                      }}>
                      {renderInline(cell, theme, `${keyPrefix}-tdc${r}-${c}`)}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      );
  }
}

export function RichText({
  text,
  style,
  themeColor = 'ink',
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  themeColor?: ThemeColor;
}) {
  const theme = useTheme();
  const blocks = useMemo(() => parseBlocks(text ?? ''), [text]);

  return (
    <View>
      {blocks.map((block, i) => (
        <View key={`blk-${i}`} style={i > 0 ? { marginTop: Space.blockSpacing } : undefined}>
          {renderBlock(block, theme, `blk${i}`)}
        </View>
      ))}
    </View>
  );
}
