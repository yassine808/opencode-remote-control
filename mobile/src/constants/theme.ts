/**
 * Design tokens.
 *
 * Direction: a calm "flight deck" for a coding agent. Deep sea-navy in dark mode,
 * cool frost in light mode. Colour is reserved for state — cobalt for actions,
 * cyan for "working", amber for "needs you", coral for failure, mint for success —
 * so a glance at the screen tells you what the agent is doing.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    scheme: 'light',
    // surfaces
    background: '#EEF1F6',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E2E7F0',
    code: '#E7EBF3',
    border: '#DAE0EB',
    // text
    text: '#0D1420',
    textSecondary: '#566074',
    textTertiary: '#8791A3',
    // action
    accent: '#2F5BFF',
    accentSoft: '#2F5BFF18',
    onAccent: '#FFFFFF',
    // state
    running: '#0A8FA8',
    runningSoft: '#0AA9C422',
    warn: '#B86E00',
    warnSoft: '#F2A93B2B',
    warnSolid: '#F2A93B',
    danger: '#D63950',
    dangerSoft: '#D6395018',
    success: '#168A5A',
    successSoft: '#1E9E6820',
    scrim: '#0D142066',
  },
  dark: {
    scheme: 'dark',
    background: '#0A1219',
    backgroundElement: '#111C26',
    backgroundSelected: '#1B2937',
    code: '#0D1721',
    border: '#1F2D3B',
    text: '#E8EEF6',
    textSecondary: '#9AA6B8',
    textTertiary: '#677386',
    accent: '#6C8CFF',
    accentSoft: '#6C8CFF22',
    onAccent: '#0A1219',
    running: '#2CCFE8',
    runningSoft: '#2CCFE81F',
    warn: '#F2A93B',
    warnSoft: '#F2A93B22',
    warnSolid: '#F2A93B',
    danger: '#FF6B7F',
    dangerSoft: '#FF6B7F1F',
    success: '#3DD598',
    successSoft: '#3DD59820',
    scrim: '#000000AA',
  },
} as const;

export type ThemeColor = Exclude<keyof typeof Colors.light & keyof typeof Colors.dark, 'scheme'>;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  small: 8,
  medium: 14,
  large: 20,
  pill: 999,
} as const;

/** Minimum comfortable touch target. */
export const Touch = 44;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 760;
