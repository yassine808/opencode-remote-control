/**
 * A run of thinking + tool calls, folded into one quiet line:
 *
 *   + 2 commands, 3 thoughts, 1 read                [⌨] [🧠] [📄]
 *
 * Tap to open the individual items. On the right, one icon per kind of work —
 * they pop in as the work happens, and the newest one breathes while the
 * agent is still going.
 */

import { useState } from 'react';
import { Animated, View } from 'react-native';

import { FadeRise, PopIn, WaveText, useLoop } from '@/components/motion';
import { ReasoningBlock } from '@/components/reasoning';
import { ThemedText } from '@/components/themed-text';
import { ToolBlock } from '@/components/tool-block';
import { Glyph, PressableScale, useReduceMotion } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { THOUGHT, kindOfTool, plural, type Kind } from '@/lib/tool-meta';
import type { ToolPart } from '@/lib/types';

export type GroupItem =
  | { kind: 'reasoning'; id: string; text: string; active: boolean }
  | { kind: 'tool'; id: string; part: ToolPart };

function summarize(items: GroupItem[]): { kind: Kind; count: number }[] {
  const order: Kind[] = [];
  const counts = new Map<string, number>();
  for (const item of items) {
    const kind = item.kind === 'reasoning' ? THOUGHT : kindOfTool(item.part.name);
    if (!counts.has(kind.key)) order.push(kind);
    counts.set(kind.key, (counts.get(kind.key) ?? 0) + 1);
  }
  return order.map((kind) => ({ kind, count: counts.get(kind.key) ?? 0 }));
}

function KindIcon({ kind, live, color }: { kind: Kind; live: boolean; color: string }) {
  const reduce = useReduceMotion();
  const loop = useLoop(1200, live && !reduce);
  const scale = loop.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.25, 1] });
  const opacity = loop.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 1, 0.6] });
  return (
    <PopIn from={0.2}>
      <Animated.View style={live && !reduce ? { opacity, transform: [{ scale }] } : undefined}>
        <Glyph set={kind.set} name={kind.icon} size={14} color={color} />
      </Animated.View>
    </PopIn>
  );
}

export function ActivityGroup({ items, active }: { items: GroupItem[]; active: boolean }) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [open, setOpen] = useState(false);

  const kinds = summarize(items);
  const label = kinds.map((k) => plural(k.kind, k.count)).join(', ');
  const newest = kinds[kinds.length - 1]?.kind.key;


  return (
    <View style={{ gap: 8 }}>
      <PressableScale
        onPress={() => setOpen((o) => !o)}
        scaleTo={0.99}
        hitSlop={8}
        accessibilityLabel={`${open ? 'Hide' : 'Show'} ${label}`}
        accessibilityState={{ expanded: open }}
        style={{ alignSelf: 'stretch' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Glyph name={open ? 'remove' : 'add'} size={14} color={theme.inkMuted} />
          <View style={{ flexShrink: 1 }}>
            {active && !reduce ? (
              <WaveText text={label} type="callout" style={{ color: theme.inkMuted }} />
            ) : (
              <ThemedText type="callout" numberOfLines={1} style={{ color: theme.inkMuted }}>
                {label}
              </ThemedText>
            )}
          </View>
          <View style={{ flex: 1 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {kinds.map((k) => (
              <KindIcon
                key={k.kind.key}
                kind={k.kind}
                live={active && k.kind.key === newest}
                color={active && k.kind.key === newest ? theme.ink : theme.inkMuted}
              />
            ))}
          </View>
        </View>
      </PressableScale>

      {open ? (
        <View style={{ gap: 10, paddingLeft: 22 }}>
          {items.map((item, i) => (
            <FadeRise key={item.id} delay={Math.min(i, 8) * 30} distance={6} duration={220}>
              {item.kind === 'reasoning' ? (
                <ReasoningBlock text={item.text} isActive={item.active} />
              ) : (
                <ToolBlock part={item.part} />
              )}
            </FadeRise>
          ))}
        </View>
      ) : null}
    </View>
  );
}
