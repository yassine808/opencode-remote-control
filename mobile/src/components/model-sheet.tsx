/**
 * Model picker and effort picker — two small sheets over the chat.
 *
 * Model: a fixed-height sheet (it never jumps as the search filters), with a
 * grab handle, search, and one row per model. Picking a model closes it.
 * Effort: its own button next to the model pill, and its own short sheet —
 * only reachable when the current model has effort levels (`variants`).
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Glyph, PressableScale } from '@/components/ui';
import { Fonts, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ModelInfo, ModelRef } from '@/lib/types';

function SheetFrame({
  visible,
  title,
  busy,
  onClose,
  fixedHeight,
  children,
}: Readonly<{
  visible: boolean;
  title: string;
  busy?: boolean;
  onClose: () => void;
  fixedHeight?: boolean;
  children: React.ReactNode;
}>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.45)' }}
          onPress={onClose}
          accessibilityLabel={`Close ${title.toLowerCase()} picker`}
        />
        <View
          style={{
            backgroundColor: theme.surface,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            borderWidth: StyleSheet.hairlineWidth,
            borderBottomWidth: 0,
            borderColor: theme.hairline,
            paddingBottom: 8 + insets.bottom,
            height: fixedHeight ? '72%' : undefined,
            maxHeight: '82%',
          }}>
          <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 4 }}>
            <View
              style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.inkSelected }}
            />
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: 20,
              paddingTop: 6,
              paddingBottom: 12,
            }}>
            <ThemedText type="headline" style={{ flex: 1 }}>
              {title}
            </ThemedText>
            {busy ? <ActivityIndicator size="small" color={theme.inkMuted} /> : null}
            <PressableScale
              onPress={onClose}
              scaleTo={0.9}
              hitSlop={8}
              accessibilityLabel="Close"
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.inkControl,
              }}>
              <Glyph name="close" size={16} color={theme.inkMuted} />
            </PressableScale>
          </View>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function ModelSheet({
  visible,
  models,
  loading,
  current,
  busy,
  onClose,
  onPick,
}: Readonly<{
  visible: boolean;
  /** null until the first fetch lands */
  models: ModelInfo[] | null;
  loading: boolean;
  current: ModelRef | null;
  /** a switch is in flight */
  busy?: boolean;
  onClose: () => void;
  onPick: (model: ModelInfo, variant?: string) => void;
}>) {
  const theme = useTheme();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  const isCurrent = (m: ModelInfo) => current?.id === m.id && current?.providerID === m.providerID;

  const filtered = useMemo(() => {
    const list = models ?? [];
    const q = query.trim().toLowerCase();
    const out = q
      ? list.filter((m) => `${m.name} ${m.providerID} ${m.id}`.toLowerCase().includes(q))
      : list;
    // the model in use floats to the top
    return [...out].sort((a, b) => Number(isCurrent(b)) - Number(isCurrent(a)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, query, current]);

  let body: React.ReactNode;
  if (loading && !models) {
    body = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.inkMuted} />
      </View>
    );
  } else if (filtered.length === 0) {
    body = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ThemedText type="callout" style={{ color: theme.inkFaint }}>
          No models match.
        </ThemedText>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={filtered}
        keyExtractor={(m) => `${m.providerID}/${m.id}`}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8 }}
        initialNumToRender={16}
        renderItem={({ item: m }) => {
          const selected = isCurrent(m);
          return (
            <PressableScale
              scaleTo={0.98}
              disabled={busy}
              onPress={() => {
                // switching models drops the effort unless the same model is re-picked
                onPick(m, selected ? (current?.variant ?? undefined) : undefined);
                onClose();
              }}
              accessibilityLabel={`Use ${m.name}`}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 11,
                borderRadius: 12,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                backgroundColor: selected ? theme.accentSoft : 'transparent',
              }}>
              <View style={{ flex: 1, gap: 1 }}>
                <ThemedText
                  type="subheadline"
                  weight={selected ? 'semibold' : 'regular'}
                  numberOfLines={1}
                  style={{ color: theme.ink }}>
                  {m.name}
                </ThemedText>
                <ThemedText type="caption" numberOfLines={1} style={{ color: theme.inkFaint }}>
                  {m.providerID}
                </ThemedText>
              </View>
              {m.variants?.length ? (
                <Glyph set="mci" name="speedometer" size={14} color={theme.inkFaint} />
              ) : null}
              {selected ? <Glyph name="checkmark" size={17} color={theme.accent} /> : null}
            </PressableScale>
          );
        }}
      />
    );
  }

  return (
    <SheetFrame visible={visible} title="Model" busy={busy} onClose={onClose} fixedHeight>
      <View
        style={{
          marginHorizontal: 20,
          marginBottom: 8,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: 40,
          paddingHorizontal: 12,
          borderRadius: Radius.control,
          backgroundColor: theme.inkWell,
          borderWidth: 1,
          borderColor: theme.inkControl,
        }}>
        <Glyph name="search" size={15} color={theme.inkFaint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search models…"
          placeholderTextColor={theme.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ flex: 1, fontFamily: Fonts.regular, fontSize: 15, color: theme.ink, padding: 0 }}
        />
        {query ? (
          <PressableScale onPress={() => setQuery('')} hitSlop={8} scaleTo={0.85}>
            <Glyph name="close-circle" size={16} color={theme.inkFaint} />
          </PressableScale>
        ) : null}
      </View>

      {body}
    </SheetFrame>
  );
}

export function EffortSheet({
  visible,
  model,
  current,
  busy,
  onClose,
  onPick,
}: Readonly<{
  visible: boolean;
  /** the session's current model, with its variants */
  model: ModelInfo | null;
  current: ModelRef | null;
  busy?: boolean;
  onClose: () => void;
  onPick: (model: ModelInfo, variant?: string) => void;
}>) {
  const theme = useTheme();
  const variants = model?.variants ?? [];
  const active = current?.variant && current.variant !== 'default' ? current.variant : null;

  const options: { id: string | null; label: string }[] = [
    { id: null, label: 'Default' },
    ...variants.filter((v) => v.id !== 'default').map((v) => ({ id: v.id, label: v.id })),
  ];

  return (
    <SheetFrame visible={visible} title="Effort" busy={busy} onClose={onClose}>
      <View style={{ paddingHorizontal: 12, paddingBottom: 8, gap: 2 }}>
        {options.map((o) => {
          const selected = o.id === active;
          return (
            <PressableScale
              key={o.id ?? 'default'}
              scaleTo={0.98}
              disabled={!model || busy}
              onPress={() => {
                if (model) onPick(model, o.id ?? undefined);
                onClose();
              }}
              accessibilityLabel={`Effort ${o.label}`}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 13,
                borderRadius: 12,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                backgroundColor: selected ? theme.accentSoft : 'transparent',
              }}>
              <ThemedText
                type="subheadline"
                weight={selected ? 'semibold' : 'regular'}
                style={{ flex: 1, color: theme.ink, textTransform: 'capitalize' }}>
                {o.label}
              </ThemedText>
              {selected ? <Glyph name="checkmark" size={17} color={theme.accent} /> : null}
            </PressableScale>
          );
        })}
      </View>
    </SheetFrame>
  );
}
