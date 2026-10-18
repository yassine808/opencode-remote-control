/**
 * A `question` tool call, shown the way the CLI shows it: the question, and
 * the answer given under it. While it is still waiting, the options show
 * instead, muted, with a "waiting" note.
 */

import { View } from 'react-native';

import { PopIn, SpinnerRing, withAlpha } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { Glyph } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import type { ToolPart } from '@/lib/types';

interface Q {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
}

function readQuestions(part: ToolPart): Q[] {
  const raw = (part.state.input ?? {}).questions;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object')
    .map((q) => ({
      question: String(q.question ?? ''),
      header: typeof q.header === 'string' ? q.header : undefined,
      options: Array.isArray(q.options)
        ? q.options
            .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
            .map((o) => ({
              label: String(o.label ?? ''),
              description: typeof o.description === 'string' ? o.description : undefined,
            }))
        : [],
    }))
    .filter((q) => q.question);
}

/** Answers per question: from metadata when present, else parsed from the tool's text output. */
function readAnswers(part: ToolPart, qs: Q[]): string[][] {
  const meta = part.state.metadata?.answers;
  if (Array.isArray(meta)) {
    return qs.map((_, i) => {
      const a = meta[i];
      if (Array.isArray(a)) return a.map(String).filter(Boolean);
      return typeof a === 'string' && a ? [a] : [];
    });
  }
  const text = (part.state.content ?? [])
    .map((b) => (typeof b.text === 'string' ? b.text : ''))
    .join('\n');
  const found = new Map<string, string>();
  const re = /"([^"]+)"="([^"]*)"/g;
  for (let m = re.exec(text); m; m = re.exec(text)) found.set(m[1], m[2]);
  return qs.map((q) => {
    const a = found.get(q.question);
    return a ? [a] : [];
  });
}

export function QuestionCard({ part }: { part: ToolPart }) {
  const theme = useTheme();
  const qs = readQuestions(part);
  const answers = readAnswers(part, qs);
  const status = part.state.status;
  const waiting = status === 'running' || status === 'pending';
  const failed = status === 'error' || !!part.state.error;

  if (qs.length === 0) return null;

  return (
    <View
      style={{
        backgroundColor: theme.surface,
        borderRadius: 12,
        padding: 14,
        gap: 14,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {waiting ? (
          <SpinnerRing size={13} stroke={1.75} color={theme.clay} duration={900} />
        ) : (
          <Glyph name="help-circle-outline" size={14} color={theme.inkMuted} />
        )}
        <ThemedText type="footnote" weight="semibold" style={{ color: theme.inkMuted }}>
          {qs.length === 1 ? 'Question' : `${qs.length} questions`}
        </ThemedText>
      </View>

      {qs.map((q, i) => {
        const picked = answers[i] ?? [];
        return (
          <View key={`${i}-${q.question}`} style={{ gap: 8 }}>
            {q.header ? (
              <ThemedText type="caption" style={{ color: theme.inkFaint }}>
                {q.header}
              </ThemedText>
            ) : null}
            <ThemedText type="callout" weight="semibold" style={{ color: theme.ink }}>
              {q.question}
            </ThemedText>

            {picked.length > 0 ? (
              <View style={{ gap: 6 }}>
                {picked.map((a) => (
                  <PopIn key={a} from={0.6}>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'flex-start',
                        gap: 8,
                        backgroundColor: withAlpha(theme.positive, 0.12),
                        borderRadius: 8,
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        alignSelf: 'flex-start',
                        maxWidth: '100%',
                      }}>
                      <Glyph name="checkmark-circle" size={14} color={theme.positive} />
                      <ThemedText type="callout" style={{ color: theme.ink, flexShrink: 1 }}>
                        {a}
                      </ThemedText>
                    </View>
                  </PopIn>
                ))}
              </View>
            ) : waiting ? (
              <View style={{ gap: 4 }}>
                {q.options.map((o) => (
                  <View key={o.label} style={{ flexDirection: 'row', gap: 8 }}>
                    <Glyph name="ellipse-outline" size={13} color={theme.inkFaint} style={{ marginTop: 3 }} />
                    <ThemedText type="callout" style={{ color: theme.inkMuted, flexShrink: 1 }}>
                      {o.label}
                      {o.description ? (
                        <ThemedText type="callout" style={{ color: theme.inkFaint }}>
                          {` — ${o.description}`}
                        </ThemedText>
                      ) : null}
                    </ThemedText>
                  </View>
                ))}
              </View>
            ) : (
              <ThemedText type="callout" style={{ color: failed ? theme.negative : theme.inkFaint }}>
                {failed ? 'Dismissed' : 'No answer'}
              </ThemedText>
            )}
          </View>
        );
      })}

      {waiting ? (
        <ThemedText type="caption" style={{ color: theme.inkFaint }}>
          Waiting for an answer…
        </ThemedText>
      ) : null}
    </View>
  );
}
