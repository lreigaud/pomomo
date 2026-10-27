import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '@/components/AppText';
import { ActionButton } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

export function DeleteTaskDialog({
  title,
  onCancel,
  onConfirm,
}: {
  title: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const colors = useColors();
  return (
    <Modal
      visible={title !== null}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="Cancel deletion" />
        <View
          accessibilityViewIsModal
          style={[styles.dialog, { backgroundColor: colors.card, borderColor: colors.border }]}
          testID="delete-task-dialog"
        >
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.foreground }]}>
            Delete this task?
          </Text>
          <Text style={[styles.message, { color: colors.mutedForeground }]}>
            Permanently delete “{title}”? This cannot be undone. Its completed focus history will stay in Progress.
          </Text>
          <ActionButton
            label="Delete task"
            icon="trash-2"
            testID="confirm-delete-task"
            onPress={onConfirm}
            style={{ backgroundColor: colors.destructive }}
          />
          <ActionButton label="Cancel" secondary testID="cancel-delete-task" onPress={onCancel} />
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
