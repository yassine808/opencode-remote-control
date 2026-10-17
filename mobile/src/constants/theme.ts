/**
 * Design tokens — a faithful port of the "Remote for OpenCode" design system
 * (their docs/design-spec.md), value for value.
 *
 * Warm neutrals throughout — the load-bearing rule of the palette.
 * `#141413` is not black, `#faf9f5` is not white, and the muted tone is a
 * khaki. A pure grey anywhere and the whole thing stops reading as warm.
 *
 * Hairlines are ink at 10% alpha — only ever used to bound a surface, never
 * as dividers in the conversation.
 *
 * Fonts: SF Pro / SF Mono don't exist on Android or the web, so the closest
 * free faces stand in — Inter (built as an SF-alike) and Roboto Mono.
 */

import '@/global.css';

import { Platform } from 'react-native';

// ---------- color ----------

export interface Palette {
  scheme: 'light' | 'dark';

  // surfaces
  canvas: string;
  surface: string;
  surfaceRaised: string;

  // ink
  ink: string;
  inkMuted: string;
  inkFaint: string;

  // accents & state
  clay: string;
  positive: string;
  negative: string;
  caution: string;
  /** Their AccentColor asset: sRGB 0.431/0.243/0.847 — the send button. */
  accent: string;

  // derived
  hairline: string;
  /** ink at 6% — composer well, code blocks */
  inkWell: string;
  /** ink at 8% — control fills, composer stroke */
  inkControl: string;
  /** ink at 12% — pressed / selected states */
  inkSelected: string;

  // ---- legacy aliases (old palette key names, kept while screens migrate)
  background: string;
  backgroundElement: string;
  backgroundSelected: string;
  code: string;
  border: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  accentSoft: string;
  onAccent: string;
  running: string;
  runningSoft: string;
  warn: string;
  warnSoft: string;
  warnSolid: string;
  danger: string;
  dangerSoft: string;
  dangerSolid: string;
  success: string;
  positiveSoft: string;
  cautionSoft: string;
  claySoft: string;
  negativeSoft: string;
}

const light: Palette = {
  scheme: 'light',

  canvas: '#FAF9F5',
  surface: '#F0EEE6',
  surfaceRaised: '#E8E6DC',

  ink: '#141413',
  inkMuted: '#5E5D59',
  inkFaint: '#87867F',

  clay: '#D97757',
  positive: '#3D9A57',
  negative: '#D1383D',
  caution: '#D68C27',
  accent: '#6E3ED8',

  hairline: 'rgba(20, 20, 19, 0.10)',
  inkWell: 'rgba(20, 20, 19, 0.06)',
  inkControl: 'rgba(20, 20, 19, 0.08)',
  inkSelected: 'rgba(20, 20, 19, 0.12)',

  background: '#FAF9F5',
  backgroundElement: '#F0EEE6',
  backgroundSelected: '#E8E6DC',
  code: 'rgba(20, 20, 19, 0.06)',
  border: 'rgba(20, 20, 19, 0.10)',
  text: '#141413',
  textSecondary: '#5E5D59',
  textTertiary: '#87867F',
  accentSoft: 'rgba(110, 62, 216, 0.12)',
  onAccent: '#FFFFFF',
  running: '#D97757',
  runningSoft: 'rgba(217, 119, 87, 0.18)',
  warn: '#D68C27',
  warnSoft: 'rgba(214, 140, 39, 0.18)',
  warnSolid: '#D68C27',
  danger: '#D1383D',
  dangerSoft: 'rgba(209, 56, 61, 0.12)',
  dangerSolid: '#D1383D',
  success: '#3D9A57',
  positiveSoft: 'rgba(61, 154, 87, 0.14)',
  cautionSoft: 'rgba(214, 140, 39, 0.18)',
  claySoft: 'rgba(217, 119, 87, 0.18)',
  negativeSoft: 'rgba(209, 56, 61, 0.12)',
};

const dark: Palette = {
  scheme: 'dark',

  canvas: '#141413',
  surface: '#1F1E1D',
  surfaceRaised: '#262624',

  ink: '#F4F0EC',
  inkMuted: '#B0AEA5',
  inkFaint: '#87867F',

  clay: '#E08A63',
  positive: '#7FD88F',
  negative: '#E06C75',
  caution: '#F5A742',
  accent: '#6E3ED8',

  hairline: 'rgba(244, 240, 236, 0.10)',
  inkWell: 'rgba(244, 240, 236, 0.06)',
  inkControl: 'rgba(244, 240, 236, 0.08)',
  inkSelected: 'rgba(244, 240, 236, 0.12)',

  background: '#141413',
  backgroundElement: '#1F1E1D',
  backgroundSelected: '#262624',
  code: 'rgba(244, 240, 236, 0.06)',
  border: 'rgba(244, 240, 236, 0.10)',
  text: '#F4F0EC',
  textSecondary: '#B0AEA5',
  textTertiary: '#87867F',
  accentSoft: 'rgba(110, 62, 216, 0.20)',
  onAccent: '#FFFFFF',
  running: '#E08A63',
  runningSoft: 'rgba(224, 138, 99, 0.20)',
  warn: '#F5A742',
  warnSoft: 'rgba(245, 167, 66, 0.20)',
  warnSolid: '#F5A742',
  danger: '#E06C75',
  dangerSoft: 'rgba(224, 108, 117, 0.16)',
  dangerSolid: '#E06C75',
  success: '#7FD88F',
  positiveSoft: 'rgba(127, 216, 143, 0.16)',
  cautionSoft: 'rgba(245, 167, 66, 0.18)',
  claySoft: 'rgba(224, 138, 99, 0.20)',
  negativeSoft: 'rgba(224, 108, 117, 0.16)',
};

export const Colors: Record<'light' | 'dark', Palette> = { light, dark };

export type ThemeColor = keyof Omit<Palette, 'scheme'>;

// ---------- space ----------

/** The spacing ladder. The gap between turns is >3× the gap between parts —
 * that ratio is the only thing telling a reader where a turn ended. */
export const Space = {
  /** markdown: extra leading between wrapped lines (folded into line heights) */
  lineExtra: 3,
  /** markdown: between blocks within one part */
  blockSpacing: 11,
  /** markdown: between list items */
  itemSpacing: 5,
  /** markdown: indent per nesting level */
  indent: 14,
  /** transcript: between parts of one turn */
  betweenParts: 12,
  /** transcript: between turns */
  betweenTurns: 40,
  /** transcript: page gutter */
  gutter: 16,
  /** user bubble inset from the leading edge */
  userInset: 48,
} as const;

/** Legacy numeric ladder still referenced during the migration. */
export const Spacing = {
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 40,
  seven: 48,
} as const;

// ---------- radius ----------

export const Radius = {
  chip: 4,
  control: 8,
  block: 12,
  sheet: 16,
  composer: 26,
  pill: 999,
  // legacy
  small: 8,
  medium: 12,
  large: 16,
} as const;

// ---------- motion ----------

/** easeOutQuart — the one curve, with feedback never longer than 200ms. */
export const Motion = {
  curve: [0.165, 0.84, 0.44, 1] as [number, number, number, number],
  feedback: 0.2,
  settle: 0.25,
  scroll: 0.2,
} as const;

// ---------- type ----------

export const Fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  italic: 'Inter_400Regular_Italic',
  semiboldItalic: 'Inter_600SemiBold_Italic',
  mono: 'RobotoMono_400Regular',
  monoMedium: 'RobotoMono_500Medium',
  monoSemibold: 'RobotoMono_600SemiBold',
  // legacy
  sans: 'Inter_400Regular',
  sansSemibold: 'Inter_600SemiBold',
} as const;

export interface TypeStyle {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
}

/** iOS text styles, mapped to point sizes. Prose adds +4 leading (lineExtra). */
export const Type: Record<
  | 'largeTitle'
  | 'title'
  | 'title2'
  | 'title3'
  | 'headline'
  | 'body'
  | 'callout'
  | 'subheadline'
  | 'footnote'
  | 'caption'
  | 'caption2',
  TypeStyle
> = {
  largeTitle: { fontFamily: Fonts.bold, fontSize: 34, lineHeight: 41 },
  title: { fontFamily: Fonts.bold, fontSize: 28, lineHeight: 34 },
  title2: { fontFamily: Fonts.bold, fontSize: 22, lineHeight: 28 },
  title3: { fontFamily: Fonts.semibold, fontSize: 20, lineHeight: 25 },
  headline: { fontFamily: Fonts.semibold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: Fonts.regular, fontSize: 17, lineHeight: 22 },
  callout: { fontFamily: Fonts.regular, fontSize: 16, lineHeight: 21 },
  subheadline: { fontFamily: Fonts.regular, fontSize: 15, lineHeight: 20 },
  footnote: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: Fonts.regular, fontSize: 12, lineHeight: 16 },
  caption2: { fontFamily: Fonts.regular, fontSize: 11, lineHeight: 13 },
};

/** Prose line heights = iOS line height + lineExtra. */
export const ProseLine = {
  body: Type.body.lineHeight + Space.lineExtra,
  callout: Type.callout.lineHeight + Space.lineExtra,
  subheadline: Type.subheadline.lineHeight + Space.lineExtra,
  footnote: Type.footnote.lineHeight + Space.lineExtra,
} as const;

/** Alias keeps the ladder readable at call sites. */
export const SpaceLine = ProseLine;

// ---------- layout ----------

/** Touch target minimum. */
export const Touch = 44;

/** Readable-width cap on wide viewports (the phone is the real target). */
export const MaxContentWidth = 560;

export const isIOS = Platform.OS === 'ios';
export const isWeb = Platform.OS === 'web';
export const isNative = Platform.OS !== 'web';
