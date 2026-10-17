/**
 * Text with the design's type scale baked in.
 *
 * All copy is Inter (SF Pro's closest free sibling); code is Roboto Mono.
 * Weight is a first-class prop because Android won't synthesize weights on
 * custom families — each weight is its own loaded face.
 */

import { Text, type TextProps, type TextStyle } from 'react-native';

import { Fonts, Type, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextType =
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
  | 'caption2'
  | 'code'
  // legacy aliases (old screens during the migration)
  | 'default'
  | 'small'
  | 'smallBold'
  | 'subtitle'
  | 'link'
  | 'linkPrimary';

export type ThemedTextWeight = 'regular' | 'medium' | 'semibold' | 'bold';

const LEGACY: Partial<Record<ThemedTextType, ThemedTextType>> = {
  default: 'body',
  small: 'subheadline',
  smallBold: 'subheadline',
  subtitle: 'title3',
  link: 'body',
  linkPrimary: 'body',
};

const FAMILY: Record<ThemedTextWeight, string> = {
  regular: Fonts.regular,
  medium: Fonts.medium,
  semibold: Fonts.semibold,
  bold: Fonts.bold,
};

const CODE: TextStyle = { fontFamily: Fonts.mono, fontSize: 13, lineHeight: 18 };

export type ThemedTextProps = TextProps & {
  type?: ThemedTextType;
  weight?: ThemedTextWeight;
  themeColor?: ThemeColor;
};

export function ThemedText({
  type = 'body',
  weight,
  themeColor,
  style,
  ...rest
}: ThemedTextProps) {
  const theme = useTheme();

  const resolved = LEGACY[type] ?? type;
  const base: TextStyle =
    resolved === 'code' ? CODE : Type[resolved as keyof typeof Type] ?? Type.body;

  const legacyLink = type === 'link' || type === 'linkPrimary';
  const color = theme[themeColor ?? (legacyLink ? 'accent' : 'ink')];

  return (
    <Text
      style={[
        {
          fontFamily: weight ? FAMILY[weight] : base.fontFamily,
          fontSize: base.fontSize,
          lineHeight: base.lineHeight,
        },
        { color },
        style,
      ]}
      {...rest}
    />
  );
}
