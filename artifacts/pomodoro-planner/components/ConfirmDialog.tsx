import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '@/components/AppText';
import { ActionButton } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

export function ConfirmDialog({
  visible,
  heading,
  message,
  confirmLabel,
  cancelLabel = 'Keep it',
  disabled,
  testID,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  heading: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  disabled?: boolean;
  testID: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const colors = useColors();
  const cancel = () => { if (!disabled) onCancel(); };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cancel}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} disabled={disabled} onPress={cancel} accessibilityLabel="Close dialog" />
        <View accessibilityViewIsModal testID={testID} style={[styles.dialog, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.foreground }]}>{heading}</Text>
          <Text style={[styles.message, { color: colors.mutedForeground }]}>{message}</Text>
          <ActionButton
            label={confirmLabel}
            icon="trash-2"
            disabled={disabled}
            testID={`${testID}-confirm`}
            onPress={onConfirm}
            style={{ backgroundColor: colors.destructive }}
          />
          <ActionButton label={cancelLabel} secondary disabled={disabled} testID={`${testID}-cancel`} onPress={cancel} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#00000066', padding: 24 },
  dialog: { width: '100%', maxWidth: 360, borderWidth: 1, borderRadius: 24, padding: 24, gap: 16 },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 21 },
  message: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 22 },
});
