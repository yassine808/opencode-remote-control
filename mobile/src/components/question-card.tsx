/**
 * A `question` tool call. While it is running, the options are the control:
 * tap to pick (or toggle, for a multi-select question), type a custom answer,
 * then submit. Once answered, the picks stay under the question the way the
 * CLI shows them.
 *
 * The form is found at submit time by its tool metadata, so the card does not
 * depend on the form being listed before the tool part paints.
 */

import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { PopIn, SpinnerRing } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { Button, Glyph, PressableScale } from '@/components/ui';
import { Fonts, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { describeError, type OpenCodeApi } from '@/lib/api';
import { useConnection } from '@/lib/connection';
import type { FormAnswer, FormInfo, ToolPart } from '@/lib/types';

interface Q {
  question: string;
  header?: string;
  multiple: boolean;
  options: { label: string; description?: string }[];
}

function readQuestions(part: ToolPart): Q[] {
  const raw = part.state.input?.questions;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object')
    .map((q) => ({
      question: typeof q.question === 'string' ? q.question : '',
      header: typeof q.header === 'string' ? q.header : undefined,
      multiple: q.multiple === true,
      options: Array.isArray(q.options)
        ? q.options
            .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
            .map((o) => ({
              label: typeof o.label === 'string' ? o.label : '',
              description: typeof o.description === 'string' ? o.description : undefined,
            }))
        : [],
    }));
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
    // The tool writes the literal "Unanswered" when a field was left blank.
    return a && a !== 'Unanswered' ? [a] : [];
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/** The pending form this tool call opened, matched by its own tool ids. */
function questionForm(forms: FormInfo[], partID: string, messageID?: string): FormInfo | null {
  const candidates = forms.filter((f) => asRecord(f.metadata)?.kind === 'question');
  const toolOf = (f: FormInfo) => asRecord(asRecord(f.metadata)?.tool);
  return (
    candidates.find((f) => toolOf(f)?.id === partID) ??
    (messageID ? candidates.find((f) => toolOf(f)?.messageID === messageID) : undefined) ??
    null
  );
}

/**
 * The form is created by the same tool call that produced the part, but the
 * two events can land out of order. A few quick retries bridge that gap.
 */
async function findQuestionForm(
  api: OpenCodeApi,
  sessionID: string,
  partID: string,
  messageID?: string,
): Promise<FormInfo> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await api.sessionForms(sessionID);
    const form = questionForm(res.data ?? [], partID, messageID);
    if (form) return form;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error('This question is no longer waiting for an answer');
}

/** One tappable option: a radio for single questions, a checkbox for multiple. */
function OptionRow({
  label,
  description,
  selected,
  multiple,
  disabled,
  onPress,
}: Readonly<{
  label: string;
  description?: string;
  selected: boolean;
  multiple: boolean;
  disabled: boolean;
  onPress: () => void;
}>) {
  const theme = useTheme();
  const mark = selected
    ? multiple
      ? 'checkbox'
      : 'radio-button-on'
    : multiple
      ? 'square-outline'
      : 'ellipse-outline';
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={description ? `${label}. ${description}` : label}
      accessibilityState={{ selected, disabled }}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: Radius.control,
        borderWidth: 1,
        borderColor: selected ? theme.accent : theme.hairline,
        backgroundColor: selected ? theme.accentSoft : theme.inkWell,
      }}>
      <Glyph name={mark} size={17} color={selected ? theme.accent : theme.inkFaint} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText type="callout" weight={selected ? 'semibold' : 'regular'}>
          {label}
        </ThemedText>
        {description ? (
          <ThemedText type="caption" style={{ color: theme.inkMuted }}>
            {description}
          </ThemedText>
        ) : null}
      </View>
    </PressableScale>
  );
}

/** What sits under one question: the picks, the options while waiting, or the outcome. */
function AnswerBlock({
  question,
  picked,
  waiting,
  failed,
}: Readonly<{ question: Q; picked: string[]; waiting: boolean; failed: boolean }>) {
  const theme = useTheme();
  if (picked.length > 0) {
    return (
      <View style={{ gap: 6 }}>
        {picked.map((a) => (
          <PopIn key={a} from={0.6}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: 8,
                backgroundColor: theme.positiveSoft,
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
    );
  }
  if (waiting) {
    return (
      <View style={{ gap: 4 }}>
        {question.options.map((o) => (
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
    );
  }
  return (
    <ThemedText type="callout" style={{ color: failed ? theme.negative : theme.inkFaint }}>
      {failed ? 'Dismissed' : 'No answer'}
    </ThemedText>
  );
}

export function QuestionCard({
  part,
  sessionID,
  messageID,
}: Readonly<{ part: ToolPart; sessionID?: string; messageID?: string }>) {
  const theme = useTheme();
  const { api } = useConnection();
  const qs = readQuestions(part);
  const answers = readAnswers(part, qs);
  const status = part.state.status;
  const waiting = status === 'running' || status === 'pending';
  const failed = status === 'error' || !!part.state.error;

  const [picked, setPicked] = useState<Record<number, string[]>>({});
  const [customOn, setCustomOn] = useState<Record<number, boolean>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const [pending, setPending] = useState<'submit' | 'dismiss' | null>(null);
  const [sent, setSent] = useState<string[][] | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (qs.length === 0) return null;

  const valuesFor = (i: number, q: Q): string[] => {
    const typed = (custom[i] ?? '').trim();
    const extra = customOn[i] && typed ? [typed] : [];
    if (!q.multiple) return customOn[i] ? extra : (picked[i] ?? []);
    const base = picked[i] ?? [];
    return [...base, ...extra.filter((v) => !base.includes(v))];
  };

  const interactive = waiting && !sent && !dismissed && !!sessionID && !!api;
  const hasAnswer = qs.some((q, i) => valuesFor(i, q).length > 0);

  const pick = (i: number, value: string, multiple: boolean) => {
    if (!interactive || pending) return;
    setError(null);
    if (multiple) {
      setPicked((prev) => {
        const cur = prev[i] ?? [];
        return {
          ...prev,
          [i]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
        };
      });
      return;
    }
    setPicked((prev) => ({ ...prev, [i]: [value] }));
    setCustomOn((prev) => ({ ...prev, [i]: false }));
  };

  const toggleCustom = (i: number) => {
    if (!interactive || pending) return;
    setError(null);
    const next = !customOn[i];
    setCustomOn((prev) => ({ ...prev, [i]: next }));
    if (next && !qs[i].multiple) setPicked((prev) => ({ ...prev, [i]: [] }));
  };

  const submit = async () => {
    if (!api || !sessionID || !interactive || pending || !hasAnswer) return;
    const answer: FormAnswer = {};
    qs.forEach((q, i) => {
      const values = valuesFor(i, q);
      if (values.length > 0) answer[`q${i}`] = q.multiple ? values : values[0];
    });
    setPending('submit');
    setError(null);
    try {
      const form = await findQuestionForm(api, sessionID, part.id, messageID);
      await api.replyForm(sessionID, form.id, answer);
      setSent(qs.map((_, i) => valuesFor(i, qs[i])));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPending(null);
    }
  };

  const dismiss = async () => {
    if (!api || !sessionID || !interactive || pending) return;
    setPending('dismiss');
    setError(null);
    try {
      const form = await findQuestionForm(api, sessionID, part.id, messageID);
      await api.cancelForm(sessionID, form.id);
      setDismissed(true);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPending(null);
    }
  };

  return (
    <View
      style={{
        backgroundColor: theme.surface,
        borderRadius: Radius.block,
        padding: 14,
        gap: 14,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: Radius.control,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.accentSoft,
          }}>
          <Glyph name="help-circle" size={15} color={theme.accent} />
        </View>
        <ThemedText type="footnote" weight="semibold" style={{ color: theme.inkMuted }}>
          {qs.length === 1 ? 'Question' : `${qs.length} questions`}
        </ThemedText>
        <View style={{ flex: 1 }} />
        {waiting ? <SpinnerRing size={13} stroke={1.75} color={theme.clay} duration={900} /> : null}
      </View>

      {qs.map((q, i) => {
        const values = sent ? (sent[i] ?? []) : (answers[i] ?? []);
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

            {interactive ? (
              <View style={{ gap: 6 }}>
                {q.options.map((o) => (
                  <OptionRow
                    key={o.label}
                    label={o.label}
                    description={o.description}
                    selected={(picked[i] ?? []).includes(o.label)}
                    multiple={q.multiple}
                    disabled={pending !== null}
                    onPress={() => pick(i, o.label, q.multiple)}
                  />
                ))}
                <PressableScale
                  onPress={() => toggleCustom(i)}
                  disabled={pending !== null}
                  accessibilityLabel="Type your own answer"
                  accessibilityState={{ selected: !!customOn[i], disabled: pending !== null }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}>
                  <Glyph
                    name={customOn[i] ? 'create' : 'create-outline'}
                    size={16}
                    color={customOn[i] ? theme.accent : theme.inkMuted}
                  />
                  <ThemedText
                    type="callout"
                    weight={customOn[i] ? 'semibold' : 'regular'}
                    style={{ color: customOn[i] ? theme.accent : theme.inkMuted }}>
                    Type your own answer
                  </ThemedText>
                </PressableScale>
                {customOn[i] ? (
                  <TextInput
                    value={custom[i] ?? ''}
                    onChangeText={(text) => setCustom((prev) => ({ ...prev, [i]: text }))}
                    placeholder="Your answer"
                    placeholderTextColor={theme.inkFaint}
                    multiline
                    editable={pending === null}
                    accessibilityLabel={`Your answer to ${q.question}`}
                    style={{
                      minHeight: 44,
                      borderRadius: Radius.control,
                      borderWidth: 1,
                      borderColor: theme.accent,
                      backgroundColor: theme.accentSoft,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      color: theme.ink,
                      fontFamily: Fonts.regular,
                      fontSize: 16,
                      textAlignVertical: 'top',
                    }}
                  />
                ) : null}
              </View>
            ) : (
              <AnswerBlock
                question={q}
                picked={values}
                waiting={waiting && !sent && !dismissed}
                failed={failed || dismissed}
              />
            )}
          </View>
        );
      })}

      {interactive ? (
        <View style={{ gap: 8 }}>
          {error ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Glyph name="warning-outline" size={13} color={theme.negative} />
              <ThemedText type="caption" style={{ color: theme.negative, flexShrink: 1 }}>
                {error}
              </ThemedText>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button
              variant="secondary"
              onPress={() => void dismiss()}
              disabled={pending !== null}
              busy={pending === 'dismiss'}
              style={{ flex: 1 }}>
              Dismiss
            </Button>
            <Button
              variant="accent"
              onPress={() => void submit()}
              disabled={!hasAnswer || pending !== null}
              busy={pending === 'submit'}
              style={{ flex: 1 }}>
              Submit
            </Button>
          </View>
        </View>
      ) : null}

      {sent ? (
        <ThemedText type="caption" style={{ color: theme.positive }}>
          Answer sent
        </ThemedText>
      ) : null}

      {waiting && !sent && !dismissed && !interactive ? (
        <ThemedText type="caption" style={{ color: theme.inkFaint }}>
          Waiting for an answer…
        </ThemedText>
      ) : null}
    </View>
  );
}
