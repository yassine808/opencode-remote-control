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
// Markers match only their own prefix; the line's content is the slice after
// it. A trailing `(.*)$` would stack quantifiers and backtrack on long lines.
const HEADING = /^(#{1,6})[ \t]+/;
const BULLET = /^([ \t]*)[-*+][ \t]+/;
const ORDERED = /^([ \t]*)(\d+)[.)][ \t]+/;
const QUOTE = /^>\s?(.*)$/;
const TABLE_SEP = /^[ \t|:-]*$/;

/** A table separator row: only separator characters, at least one dash. */
function isTableSep(line: string): boolean {
  return TABLE_SEP.test(line) && line.includes('-');
}

function splitCells(line: string): string[] {
  const cells = line.split('|').map((c) => c.trim());
  if (cells.length > 0 && cells[0] === '') cells.shift();
  if (cells.length > 0 && cells.at(-1) === '') cells.pop();
  return cells;
}

interface BlockParse {
  block: Block;
  next: number;
}

function startsNewBlock(line: string): boolean {
  return (
    line.trim() === '' ||
    FENCE.test(line) ||
    HEADING.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line) ||
    QUOTE.test(line)
  );
}

function parseFence(lines: string[], start: number): BlockParse {
  const fence = FENCE.exec(lines[start]);
  const body: string[] = [];
  let i = start + 1;
  while (i < lines.length && !FENCE.test(lines[i])) {
    body.push(lines[i]);
    i++;
  }
  if (i < lines.length) i++; // closing fence
  return {
    block: { kind: 'code', code: body.join('\n'), lang: (fence?.[1] || '').toLowerCase() },
    next: i,
  };
}

function parseList(lines: string[], start: number): BlockParse {
  const items: { depth: number; marker: string; text: string }[] = [];
  let ordered = false;
  let i = start;
  while (i < lines.length) {
    const b = BULLET.exec(lines[i]);
    const o = ORDERED.exec(lines[i]);
    if (b) {
      items.push({ depth: Math.floor(b[1].length / 2), marker: '•', text: lines[i].slice(b[0].length) });
    } else if (o) {
      ordered = true;
      items.push({ depth: Math.floor(o[1].length / 2), marker: `${o[2]}.`, text: lines[i].slice(o[0].length) });
    } else {
      break;
    }
    i++;
  }
  return { block: { kind: 'list', ordered, items }, next: i };
}

function parseQuote(lines: string[], start: number): BlockParse {
  const body: string[] = [];
  let i = start;
  while (i < lines.length) {
    const q = QUOTE.exec(lines[i]);
    if (!q) break;
    body.push(q[1]);
    i++;
  }
  return { block: { kind: 'quote', lines: body }, next: i };
}

function isTableStart(lines: string[], i: number): boolean {
  const next = lines[i + 1];
  return lines[i].includes('|') && next != null && isTableSep(next);
}

function parseTable(lines: string[], start: number): BlockParse {
  const header = splitCells(lines[start]);
  let i = start + 2;
  const rows: string[][] = [];
  while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
    rows.push(splitCells(lines[i]));
    i++;
  }
  return { block: { kind: 'table', header, rows }, next: i };
}

function parseParagraph(lines: string[], start: number): BlockParse {
  const body: string[] = [];
  let i = start;
  while (i < lines.length && !startsNewBlock(lines[i])) {
    body.push(lines[i]);
    i++;
  }
  return { block: { kind: 'paragraph', lines: body }, next: i };
}

function parseBlocks(text: string): Block[] {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    if (FENCE.test(line)) {
      const { block, next } = parseFence(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: line.slice(heading[0].length) });
      i++;
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      const { block, next } = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }

    if (QUOTE.test(line)) {
      const { block, next } = parseQuote(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }

    if (isTableStart(lines, i)) {
      const { block, next } = parseTable(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }

    // paragraph — runs until a blank line or anything that starts a block
    const { block, next } = parseParagraph(lines, i);
    blocks.push(block);
    i = next;
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
  let comment = String.raw`\/\/[^\n]*`;
  if (DASH_COMMENT.has(lang)) comment = '--[^\n]*';
  else if (HASH_COMMENT.has(lang)) comment = '#[^\n]*|//[^\n]*';
  const re = new RegExp(
    String.raw`(\/\*[\s\S]*?\*\/|${comment})` + // 1 comment
      String.raw`|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\x60(?:\\.|[^\x60\\])*\x60)` + // 2 string
      String.raw`|(\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?\b)` + // 3 number
      String.raw`|(\b[A-Za-z_]\w*\b)(?=(\())?`, // 4 word, 5 call
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
    push(t, tokenColor(m, c, base));
    last = m.index + t.length;
    if (t.length === 0) re.lastIndex++;
  }
  if (last < code.length) push(code.slice(last), base);
  return out;
}

function tokenColor(m: RegExpExecArray, c: Cli, base: string): string {
  if (m[1] != null) return c.com;
  if (m[2] != null) return c.str;
  if (m[3] != null) return c.num;
  const w = m[4];
  if (KEYWORDS.has(w)) return c.kw;
  if (m[5]) return c.fn;
  if (/^[A-Z]\w*$/.test(w)) return c.type;
  return base;
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
      <Text key={i /* NOSONAR — a diff is rebuilt from scratch on every render; index keys are correct here */} style={{ color, backgroundColor: bg }}>
        {line}
        {i < all.length - 1 ? '\n' : ''}
      </Text>
    );
  });
}

function withAlpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = Number.parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ---------- inline model ----------

/**
 * Inline tokens are found by probing each delimiter position, in priority
 * order. A single alternation rescans the tail of the string whenever a
 * branch fails — quadratic on inputs like a long run of "[" — so candidates
 * come from a plain scan and each pattern is only tried where it can start.
 * The patterns are sticky: a probe costs one token attempt, never a tail scan.
 */
const INLINE_CANDIDATE = /[`[*_~]/g;
const INLINE_CODE = /`[^`\n]+`/y;
const INLINE_LINK = /\[[^\]]+\]\([^)\s]+\)/y;
const INLINE_BOLD = /\*\*[^*]+\*\*/y;
const INLINE_ITALIC = /\*[^*\n]+\*/y;
const INLINE_UNDERLINE = /_[^_\n]+_/y;
const INLINE_STRIKE = /~~[^~]+~~/y;

interface InlineSpan {
  start: number;
  end: number;
}

/** Positions of the last closing delimiter of each kind. */
interface InlineEnds {
  backtick: number;
  bracket: number;
  star: number;
  underscore: number;
  tilde: number;
}

/** Match `re` only when it starts exactly at `pos`, and only if a closer exists. */
function matchAt(re: RegExp, text: string, pos: number, lastClose: number): string | null {
  if (pos + 1 >= lastClose) return null;
  re.lastIndex = pos; // sticky — the attempt is anchored at `pos`
  return re.exec(text)?.[0] ?? null;
}

/** The token starting at `pos`, or null. Branches are keyed by their opener. */
function probeToken(text: string, pos: number, ends: InlineEnds): string | null {
  const ch = text[pos];
  if (ch === '`') return matchAt(INLINE_CODE, text, pos, ends.backtick);
  if (ch === '[') return matchAt(INLINE_LINK, text, pos, ends.bracket);
  if (ch === '*') {
    return matchAt(INLINE_BOLD, text, pos, ends.star) ?? matchAt(INLINE_ITALIC, text, pos, ends.star);
  }
  if (ch === '_') return matchAt(INLINE_UNDERLINE, text, pos, ends.underscore);
  return matchAt(INLINE_STRIKE, text, pos, ends.tilde);
}

function scanInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const ends: InlineEnds = {
    backtick: text.lastIndexOf('`'),
    bracket: text.lastIndexOf(']'),
    star: text.lastIndexOf('*'),
    underscore: text.lastIndexOf('_'),
    tilde: text.lastIndexOf('~'),
  };
  INLINE_CANDIDATE.lastIndex = 0;
  let c: RegExpExecArray | null;
  while ((c = INLINE_CANDIDATE.exec(text)) !== null) {
    const token = probeToken(text, c.index, ends);
    if (token !== null) {
      spans.push({ start: c.index, end: c.index + token.length });
      INLINE_CANDIDATE.lastIndex = c.index + token.length;
    }
  }
  return spans;
}

const LINK_TOKEN = /^\[([^\]]+)\]\(([^)\s]+)\)$/;

type InlineKind = 'code' | 'link' | 'bold' | 'strike' | 'italic';

function inlineKind(token: string): InlineKind {
  if (token.startsWith('`')) return 'code';
  if (token.startsWith('[')) return 'link';
  if (token.startsWith('**')) return 'bold';
  if (token.startsWith('~~')) return 'strike';
  return 'italic';
}

function renderToken(
  token: string,
  kind: InlineKind,
  theme: Palette,
  keyPrefix: string,
  bold: boolean,
): ReactNode {
  const c = cliColors(theme);
  switch (kind) {
    case 'code':
      return (
        <Text style={{ fontFamily: Fonts.mono, fontSize: 15, color: c.code }}>
          {token.slice(1, -1)}
        </Text>
      );
    case 'link': {
      const link = LINK_TOKEN.exec(token);
      if (!link) return token;
      const url = link[2];
      return (
        <Text
          style={{ color: c.link, textDecorationLine: 'underline' }}
          onPress={() => {
            Linking.openURL(url).catch(() => {});
          }}>
          {renderInline(link[1], theme, `${keyPrefix}-l`, bold)}
        </Text>
      );
    }
    case 'bold':
      return (
        <Text style={{ fontFamily: Fonts.semibold, color: c.bold }}>
          {renderInline(token.slice(2, -2), theme, `${keyPrefix}-b`, true)}
        </Text>
      );
    case 'strike':
      return (
        <Text style={{ textDecorationLine: 'line-through', color: c.strike }}>
          {renderInline(token.slice(2, -2), theme, `${keyPrefix}-s`, bold)}
        </Text>
      );
    case 'italic':
      return (
        <Text
          style={{
            fontFamily: bold ? Fonts.semiboldItalic : Fonts.italic,
            color: c.italic,
          }}>
          {renderInline(token.slice(1, -1), theme, `${keyPrefix}-i`, bold)}
        </Text>
      );
  }
}

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

  for (const span of scanInline(text)) {
    if (span.start > last) push(text.slice(last, span.start));
    const token = text.slice(span.start, span.end);
    const kind = inlineKind(token);
    push(renderToken(token, kind, theme, `${keyPrefix}-${kind[0]}${key}`, bold));
    last = span.end;
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
}: Readonly<{
  code: string;
  lang?: string;
  style?: StyleProp<ViewStyle>;
}>) {
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
}: Readonly<{
  text: string;
  style?: StyleProp<TextStyle>;
  themeColor?: ThemeColor;
}>) {
  const theme = useTheme();
  const blocks = useMemo(() => parseBlocks(text ?? ''), [text]);

  return (
    <View>
      {blocks.map((block, i) => (
        <View key={`blk-${i}` /* NOSONAR — blocks are rebuilt from scratch on every render; index keys are correct here */} style={i > 0 ? { marginTop: Space.blockSpacing } : undefined}>
          {renderBlock(block, theme, `blk${i}`)}
        </View>
      ))}
    </View>
  );
}
