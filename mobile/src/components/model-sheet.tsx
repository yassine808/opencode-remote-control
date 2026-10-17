/**
 * Model & effort picker — a sheet over the chat.
 *
 * The design pack deliberately has no model control; this is the deliberate
 * addition, shelved under one muted pill in the composer so the common path
 * (type, send) stays one tap. "Effort" is the model's own `variants`
 * (low…max, thinking…) and only shows for models that have any.
 */

import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
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

export function ModelSheet({
  visible,
  models,
  loading,
  current,
  busy,
  onClose,
  onPick,
}: {
  visible: boolean;
  /** null until the first fetch lands */
  models: ModelInfo[] | null;
  loading: boolean;
  current: ModelRef | null;
  /** a switch is in flight */
  busy?: boolean;
  onClose: () => void;
  onPick: (model: ModelInfo, variant?: string) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const isCurrent = (m: ModelInfo) => current?.id === m.id && current?.providerID === m.providerID;

  const currentInfo = useMemo(
    () =>
      current && models
        ? models.find((m) => m.id === current.id && m.providerID === current.providerID) ?? null
        : null,
    [current, models],
  );
  const variants = currentInfo?.variants ?? [];
  const activeVariant = current?.variant ?? 'none';

  const filtered = useMemo(() => {
    const list = models ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => `${m.name} ${m.providerID} ${m.id}`.toLowerCase().includes(q));
  }, [models, query]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.45)', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close model picker" />

        <View
          style={{
            backgroundColor: theme.surface,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.hairline,
            paddingTop: 16,
            paddingBottom: 12 + insets.bottom,
            maxHeight: '80%',
            gap: 14,
          }}>
          <View
            style={{ paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <ThemedText type="headline" style={{ flex: 1 }}>
              Model
            </ThemedText>
            {busy ? <ActivityIndicator size="small" color={theme.inkMuted} /> : null}
          </View>

          {variants.length > 0 ? (
            <View style={{ gap: 8 }}>
              <ThemedText type="caption" style={{ color: theme.inkMuted, paddingHorizontal: 20 }}>
                Effort
              </ThemedText>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6, paddingHorizontal: 20 }}>
                {variants.map((v) => {
                  const active = v.id === activeVariant;
                  return (
                    <PressableScale
                      key={v.id}
                      scaleTo={0.95}
                      disabled={!currentInfo || busy}
                      onPress={() => {
                        if (currentInfo) onPick(currentInfo, v.id);
                      }}
                      accessibilityLabel={`Effort ${v.id}`}
                      style={{
                        height: 28,
                        paddingHorizontal: 12,
                        borderRadius: 14,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: active ? theme.accentSoft : theme.inkWell,
                        borderWidth: 1,
                        borderColor: active ? theme.accent : theme.inkControl,
                      }}>
                      <ThemedText
                        type="caption"
                        weight={active ? 'semibold' : 'regular'}
                        style={{ color: active ? theme.accent : theme.inkMuted }}>
                        {v.id}
                      </ThemedText>
                    </PressableScale>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          <View
            style={{
              marginHorizontal: 20,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              height: 36,
              paddingHorizontal: 10,
              borderRadius: Radius.control,
              backgroundColor: theme.inkWell,
              borderWidth: 1,
              borderColor: theme.inkControl,
            }}>
            <Glyph name="search" size={14} color={theme.inkFaint} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search models…"
              placeholderTextColor={theme.inkFaint}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                flex: 1,
                fontFamily: Fonts.regular,
                fontSize: 15,
                color: theme.ink,
                padding: 0,
              }}
            />
          </View>

          {loading && !models ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}>
              <ActivityIndicator color={theme.inkMuted} />
            </View>
          ) : filtered.length === 0 ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}>
              <ThemedText type="callout" style={{ color: theme.inkFaint }}>
                No models match.
              </ThemedText>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(m) => `${m.providerID}/${m.id}`}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ paddingBottom: 4 }}
              initialNumToRender={16}
              renderItem={({ item: m }) => {
                const selected = isCurrent(m);
                return (
                  <PressableScale
                    scaleTo={0.98}
                    disabled={busy}
                    onPress={() =>
                      onPick(m, selected ? (current?.variant ?? undefined) : undefined)
                    }
                    accessibilityLabel={`Use ${m.name}`}
                    style={{
                      paddingHorizontal: 20,
                      paddingVertical: 10,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                    }}>
                    <View style={{ flex: 1, gap: 1 }}>
                      <ThemedText
                        type="subheadline"
                        numberOfLines={1}
                        style={{ color: theme.ink }}>
                        {m.name}
                      </ThemedText>
                      <ThemedText
                        type="caption"
                        numberOfLines={1}
                        style={{ color: theme.inkFaint }}>
                        {m.providerID}
                      </ThemedText>
                    </View>
                    {selected ? <Glyph name="checkmark" size={16} color={theme.accent} /> : null}
                  </PressableScale>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}
