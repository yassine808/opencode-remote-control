/**
 * The wordmark, drawn rather than set.
 *
 * OpenCode's logotype is a module grid — letters four units wide, one unit
 * apart, one-unit stroke, no optical kerning — constructed lettering in the
 * Wim Crouwel *New Alphabet* tradition. There is no typeface involved: the
 * letterforms are geometry. Ported cell-for-cell from their Glyphs.swift.
 *
 * Uppercase on purpose: OpenCode's logotype is lowercase, and reproducing it
 * exactly would read as an official mark rather than a compatible one.
 */

import { useMemo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

const ROWS = 5;
const GLYPH_WIDTH = 4;
/** Between letters. A space is this plus two. */
const GAP = 1;

const TABLE: Record<string, readonly string[]> = {
  O: ['####', '#..#', '#..#', '#..#', '####'],
  P: ['####', '#..#', '####', '#...', '#...'],
  E: ['####', '#...', '####', '#...', '####'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  C: ['####', '#...', '#...', '#...', '####'],
  D: ['###.', '#..#', '#..#', '#..#', '###.'],
  G: ['####', '#...', '#.##', '#..#', '####'],
  F: ['####', '#...', '####', '#...', '#...'],
  R: ['####', '#..#', '####', '#.#.', '#..#'],
  // M and T strain a 4-wide grid: M's twin peaks become a filled second row
  // (the New Alphabet's own concession), and T's stem sits one cell left of
  // true centre because there is no centre.
  M: ['#..#', '####', '#..#', '#..#', '#..#'],
  T: ['####', '.#..', '.#..', '.#..', '.#..'],
};

/** Total width in cells, including inter-letter gaps. */
export function glyphWidth(text: string): number {
  let total = 0;
  const chars = Array.from(text.toUpperCase());
  chars.forEach((ch, i) => {
    if (i > 0) total += GAP;
    total += ch === ' ' || !TABLE[ch] ? GAP + 2 : GLYPH_WIDTH;
  });
  return total;
}

/** Every inked cell as [column, row]. */
function glyphCells(text: string): [number, number][] {
  const out: [number, number][] = [];
  let x = 0;
  const chars = Array.from(text.toUpperCase());
  chars.forEach((ch, i) => {
    if (i > 0) x += GAP;
    const glyph = TABLE[ch];
    if (!glyph) {
      x += GAP + 2; // space / unknown
      return;
    }
    glyph.forEach((line, row) => {
      for (let column = 0; column < line.length; column++) {
        if (line[column] === '#') out.push([x + column, row]);
      }
    });
    x += GLYPH_WIDTH;
  });
  return out;
}

export const WORDMARK_FULL = 'REMOTE FOR OPENCODE';
export const WORDMARK_COMPACT = 'REMOTE';

export function BrandWordmark({
  height = 16,
  color,
  text = WORDMARK_FULL,
  style,
}: Readonly<{
  /** Height of the lettering. Five rows of cells, so a cell is a fifth. */
  height?: number;
  color?: string;
  text?: string;
  style?: StyleProp<ViewStyle>;
}>) {
  const theme = useTheme();
  const ink = color ?? theme.ink;

  // Cells are whole points. A fractional cell puts every edge on a
  // sub-pixel boundary and the antialiasing eats the letterforms.
  const cell = Math.max(1, Math.round(height / ROWS));
  const cells = useMemo(() => glyphCells(text), [text]);
  const columns = useMemo(() => glyphWidth(text), [text]);

  return (
    <View
      accessibilityLabel="Remote for OpenCode"
      style={[{ width: cell * columns, height: cell * ROWS }, style]}
      pointerEvents="none">
      {cells.map(([col, row]) => (
        <View
          key={`${col}-${row}`}
          style={{
            position: 'absolute',
            left: col * cell,
            top: row * cell,
            width: cell,
            height: cell,
            backgroundColor: ink,
          }}
        />
      ))}
    </View>
  );
}
