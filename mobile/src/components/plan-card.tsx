/**
 * The agent's own plan for the turn.
 *
 * This is the clearest possible answer to "what is it doing and how far
 * along is it" — better than any spinner, because it's the agent's account
 * of its own work rather than our guess at it. Shown while the turn runs
 * and left in place afterwards as a record.
 */

import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Glyph } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority?: string;
}

/** The status mark for one todo. */
function TodoGlyph({ status, color }: Readonly<{ status: TodoItem['status']; color: string }>) {
  if (status === 'completed') return <Glyph name="checkmark-circle" size={13} color={color} />;
  if (status === 'cancelled') return <Glyph name="close-circle-outline" size={13} color={color} />;
  return <Glyph name="ellipse-outline" size={13} color={color} />;
}

function TodoRow({ todo }: Readonly<{ todo: TodoItem }>) {
  const theme = useTheme();
  const done = todo.status === 'completed';
  const cancelled = todo.status === 'cancelled';
  const active = todo.status === 'in_progress';

  let tint = theme.inkFaint;
  if (done) tint = theme.positive;
  else if (active) tint = theme.clay;
  const textColor = done || cancelled ? theme.inkFaint : theme.ink;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
      <View style={{ paddingTop: 1 }}>
        <TodoGlyph status={todo.status} color={tint} />
      </View>
      <ThemedText
        type="footnote"
        style={{
          color: textColor,
          flex: 1,
          textDecorationLine: cancelled ? 'line-through' : 'none',
        }}>
        {todo.content}
      </ThemedText>
    </View>
  );
}

export function PlanCard({ todos }: Readonly<{ todos: TodoItem[] }>) {
  const theme = useTheme();

  if (!todos.length) return null;

  const remaining = todos.filter((t) => t.status !== 'completed' && t.status !== 'cancelled').length;
  const counter = remaining === 0 ? 'all done' : `${todos.length - remaining}/${todos.length}`;

  return (
    <View
      style={{
        backgroundColor: theme.surface,
        borderRadius: 12,
        padding: 12,
        gap: 8,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <ThemedText type="caption" weight="semibold" style={{ color: theme.inkMuted }}>
          Plan
        </ThemedText>
        <View style={{ flex: 1 }} />
        <ThemedText
          type="caption"
          style={{ color: theme.inkMuted, fontVariant: ['tabular-nums'] }}>
          {counter}
        </ThemedText>
      </View>

      {todos.map((todo) => (
        <TodoRow key={todo.content} todo={todo} />
      ))}
    </View>
  );
}
