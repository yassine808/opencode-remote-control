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

/** Minimal ANSI SGR parser: colours + bold; every other escape is dropped. */
export function parseAnsi(input: string): Seg[] {
  const out: Seg[] = [];
  let color: string | undefined;
  let bold = false;
  // eslint-disable-next-line no-control-regex
  const re = /\x1b\[([0-9;?]*)([A-Za-z])/g;
  let last = 0;
  for (let m = re.exec(input); m; m = re.exec(input)) {
    if (m.index > last) out.push({ text: input.slice(last, m.index), color, bold });
    last = m.index + m[0].length;
    if (m[2] !== 'm') continue;
    const codes = (m[1] === '' ? '0' : m[1]).split(';').map((n) => parseInt(n, 10) || 0);
    for (const c of codes) {
      if (c === 0) {
        color = undefined;
        bold = false;
      } else if (c === 1) bold = true;
      else if (c === 22) bold = false;
      else if (c === 39) color = undefined;
      else if (ANSI[c]) color = ANSI[c];
    }
  }
  if (last < input.length) out.push({ text: input.slice(last), color, bold });
  return out;
}

function outputOf(part: ToolPart): string {
  const fromContent = (part.state.content ?? [])
    .map((b) => (typeof b.text === 'string' ? b.text : ''))
    .join('')
    .replace(/\r\n/g, '\n');
  if (fromContent.trim()) return fromContent;
  const meta = part.state.metadata ?? {};
  for (const key of ['output', 'stdout']) {
    const v = meta[key];
    if (typeof v === 'string' && v.trim()) return v.replace(/\r\n/g, '\n');
  }
  return '';
}

export function Terminal({ part }: { part: ToolPart }) {
  const input = part.state.input ?? {};
  const command = typeof input.command === 'string' ? input.command : '';
  const description = typeof input.description === 'string' ? input.description : '';
  const cwd = typeof input.workdir === 'string' ? input.workdir : '';
  const status = part.state.status;
  const running = status === 'running' || status === 'pending';
  const errored = status === 'error' || !!part.state.error;
  const exit = part.state.metadata?.exit;
  const failed = errored || (typeof exit === 'number' && exit !== 0);
  const output = outputOf(part);
  const errText = part.state.error?.message;

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
            {parseAnsi(output).map((seg, i) => (
              <Text
                key={i}
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
            {failed
              ? typeof exit === 'number'
                ? `exited with code ${exit}`
                : 'failed'
              : output
                ? 'done'
                : 'done · no output'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
