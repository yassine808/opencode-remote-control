/**
 * An image inside the conversation — a screenshot the user attached to a
 * prompt, or an image a tool returned.
 *
 * Thumbnails settle on the decoded aspect ratio (no cropping, no guessing);
 * tapping opens the full picture over everything, since dense screenshots are
 * unreadable at chat width.
 */

import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface Props {
  uri: string;
  label?: string | null;
  /** User attachments sit right (with the bubble); tool output sits left. */
  align?: 'left' | 'right';
}

export function MessageImage({ uri, label, align = 'left' }: Props) {
  const theme = useTheme();
  const [ratio, setRatio] = useState(1.6);
  const [open, setOpen] = useState(false);

  const onLoad = (event: { source?: { width?: number; height?: number } | null }) => {
    const w = event?.source?.width;
    const h = event?.source?.height;
    if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) {
      setRatio(w / h);
    }
  };

  return (
    <>
      <PressableScale
        onPress={() => setOpen(true)}
        scaleTo={0.98}
        accessibilityRole="button"
        accessibilityLabel={label ? `Image ${label} — tap to open` : 'Image — tap to open'}
        style={{
          alignSelf: align === 'right' ? 'flex-end' : 'flex-start',
          width: '82%',
          maxWidth: 340,
          borderRadius: Radius.block,
          overflow: 'hidden',
        }}>
        <Image
          source={{ uri }}
          onLoad={onLoad}
          contentFit="contain"
          style={{
            width: '100%',
            aspectRatio: ratio,
            backgroundColor: theme.inkWell,
          }}
        />
      </PressableScale>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}>
        <Pressable
          style={styles.backdrop}
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Close image">
          <Image source={{ uri }} contentFit="contain" style={styles.full} />
          {label ? (
            <ThemedText type="caption" style={styles.caption}>
              {label}
            </ThemedText>
          ) : null}
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0B0B0A' },
  full: { flex: 1, margin: Space.betweenParts },
  caption: {
    position: 'absolute',
    bottom: 32,
    alignSelf: 'center',
    color: '#B0AEA5',
  },
});
