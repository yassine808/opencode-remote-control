/**
 * A shell call, drawn like a terminal: dark window, green `$` prompt, the
 * command, then its output with ANSI colours honoured. Output scrolls both
 * ways (a wrapped log line is a lie about where the line ends).
 */

import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import type { ToolPart } from '@/lib/types';

const BG = '#0C0C0C';
const FG = '#D4D4D4';
const DIM = '#7A7A7A';
const GREEN = '#7FD88F';
const RED = '#F07178';

const ANSI: Record<number, string> = {
  30: '#5C5C5C', 31: '#F07178', 32: '#7FD88F', 33: '#E5C07B',
  34: '#61AFEF', 35: '#C678DD', 36: '#56B6C2', 37: '#D4D4D4',
  90: '#7A7A7A', 91: '#FF8B92', 92: '#9BE9A8', 93: '#F5D58A',
  94: '#82C4FF', 95: '#DA9AEE', 96: '#7CD3DD', 97: '#FFFFFF',
};

interface Seg {
  text: string;
  color?: string;
  bold?: boolean;
}

/** Applies one SGR code to the running style, in place. */
function applySgr(code: number, style: { color?: string; bold: boolean }): void {
  if (code === 0) {
    style.color = undefined;
    style.bold = false;
  } else if (code === 1) style.bold = true;
  else if (code === 22) style.bold = false;
  else if (code === 39) style.color = undefined;
  else if (ANSI[code]) style.color = ANSI[code];
}

/** Minimal ANSI SGR parser: colours + bold; every other escape is dropped. */
export function parseAnsi(input: string): Seg[] {
  const out: Seg[] = [];
  const style: { color?: string; bold: boolean } = { bold: false };
  const re = /\x1b\[([0-9;?]*)([A-Za-z])/g;
  let last = 0;
  for (let m = re.exec(input); m; m = re.exec(input)) {
    if (m.index > last)
      out.push({ text: input.slice(last, m.index), color: style.color, bold: style.bold });
    last = m.index + m[0].length;
    if (m[2] !== 'm') continue;
    const codes = (m[1] === '' ? '0' : m[1]).split(';').map((n) => Number.parseInt(n, 10) || 0);
    for (const code of codes) applySgr(code, style);
  }
  if (last < input.length)
    out.push({ text: input.slice(last), color: style.color, bold: style.bold });
  return out;
}

/** Pairs segments with stable keys (position is the only identity they have). */
function keyed(segs: Seg[]): { key: number; seg: Seg }[] {
  let n = 0;
  return segs.map((seg) => ({ key: n++, seg }));
}

function outputOf(part: ToolPart): string {
  const fromContent = (part.state.content ?? [])
    .map((b) => (typeof b.text === 'string' ? b.text : ''))
    .join('')
    .replaceAll('\r\n', '\n');
  if (fromContent.trim()) return fromContent;
  const meta = part.state.metadata ?? {};
  for (const key of ['output', 'stdout']) {
    const v = meta[key];
    if (typeof v === 'string' && v.trim()) return v.replaceAll('\r\n', '\n');
  }
  return '';
}

/** The pieces of a tool call the terminal chrome renders. */
function shellState(part: ToolPart) {
  const input = part.state.input ?? {};
  const exit = part.state.metadata?.exit;
  return {
    command: typeof input.command === 'string' ? input.command : '',
    description: typeof input.description === 'string' ? input.description : '',
    cwd: typeof input.workdir === 'string' ? input.workdir : '',
    running: part.state.status === 'running' || part.state.status === 'pending',
    failed:
      part.state.status === 'error' ||
      !!part.state.error ||
      (typeof exit === 'number' && exit !== 0),
    exit,
    output: outputOf(part),
    errText: part.state.error?.message,
  };
}

/** The one-line result shown under a finished command. */
function exitLabel(failed: boolean, exit: unknown, output: string): string {
  if (failed) return typeof exit === 'number' ? `exited with code ${exit}` : 'failed';
  return output ? 'done' : 'done · no output';
}

export function Terminal({ part }: Readonly<{ part: ToolPart }>) {
  const { command, description, cwd, running, failed, exit, output, errText } = shellState(part);

  const [blink, setBlink] = useState(true);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setBlink((b) => !b), 500);
    return () => clearInterval(t);
  }, [running]);

  const mono = { fontFamily: Fonts.mono, fontSize: 12.5, lineHeight: 18 } as const;

  return (
    <View style={{ backgroundColor: BG, borderRadius: 10, overflow: 'hidden' }}>
      {/* title bar */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: '#1A1A1A',
        }}>
        {['#FF5F56', '#FFBD2E', '#27C93F'].map((c) => (
          <View key={c} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c }} />
        ))}
        <Text
          numberOfLines={1}
          style={{ ...mono, fontSize: 11, color: DIM, marginLeft: 6, flexShrink: 1 }}>
          {description || cwd || 'shell'}
        </Text>
      </View>

      <ScrollView
        style={{ maxHeight: 340 }}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}>
        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ padding: 12 }}>
          <Text selectable style={{ ...mono, color: FG }}>
            <Text style={{ color: GREEN }}>$ </Text>
            <Text style={{ color: '#FFFFFF' }}>{command}</Text>
            {output ? '\n' : ''}
            {keyed(parseAnsi(output)).map(({ key, seg }) => (
              <Text
                key={key}
                style={{
                  color: seg.color ?? FG,
                  fontFamily: seg.bold ? Fonts.monoSemibold : Fonts.mono,
                }}>
                {seg.text}
              </Text>
            ))}
            {errText ? (
              <Text style={{ color: RED }}>{`\n${errText}`}</Text>
            ) : null}
            {running ? (
              <Text style={{ color: GREEN, opacity: blink ? 1 : 0 }}>{'\n█'}</Text>
            ) : null}
          </Text>
        </ScrollView>
      </ScrollView>

      {!running ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
          <Text style={{ ...mono, fontSize: 11, color: failed ? RED : DIM }}>
            {exitLabel(failed, exit, output)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
