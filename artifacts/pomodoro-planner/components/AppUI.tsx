import React, { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  TextStyle,
  View,
  ViewStyle,
  Platform,
} from 'react-native';
import { AppText as Text } from '@/components/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useFocus } from '@/store/FocusContext';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

export function Page({
  children,
  scroll = true,
  keyboardAware = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  keyboardAware?: boolean;
}) {
  const colors = useColors();
  const body = keyboardAware ? (
    <KeyboardAwareScrollViewCompat
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.pageContent}
      keyboardShouldPersistTaps="handled"
      bottomOffset={60}
    >
      <Notice />
      {children}
    </KeyboardAwareScrollViewCompat>
  ) : scroll ? (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.pageContent}
      keyboardShouldPersistTaps="handled"
    >
      <Notice />
      {children}
    </ScrollView>
  ) : (
    <View style={styles.pageContent}><Notice />{children}</View>
  );
  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[
        styles.page,
        { backgroundColor: colors.background },
        Platform.OS === 'web' && styles.webPage,
      ]}
    >
      {body}
    </SafeAreaView>
  );
}

export function PageHeading({
  eyebrow,
  title,
  subtitle,
  right,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.heading}>
      <View style={styles.headingCopy}>
        {eyebrow ? (
          <Text style={[styles.eyebrow, { color: colors.primary }]}>{eyebrow}</Text>
        ) : null}
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export function Surface({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.surface,
        { backgroundColor: colors.card, borderColor: colors.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Label({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  const colors = useColors();
  return (
    <Text style={[styles.label, { color: colors.mutedForeground }, style]}>
      {children}
    </Text>
  );
}

export function ActionButton({
  label,
  onPress,
  icon,
  secondary = false,
  disabled = false,
  testID,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: React.ComponentProps<typeof Feather>['name'];
  secondary?: boolean;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: secondary ? colors.secondary : colors.primary,
          opacity: disabled ? 0.5 : pressed ? 0.78 : 1,
        },
        style,
      ]}
    >
      {icon ? (
        <Feather
          name={icon}
          size={16}
          color={secondary ? colors.secondaryForeground : colors.primaryForeground}
        />
      ) : null}
      <Text
        style={[
          styles.actionText,
          { color: secondary ? colors.secondaryForeground : colors.primaryForeground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  color,
  disabled,
  testID,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [styles.iconButton, { opacity: disabled ? 0.35 : pressed ? 0.5 : 1 }]}
    >
      <Feather name={icon} size={20} color={color ?? colors.foreground} />
    </Pressable>
  );
}

export function Notice() {
  const { storageError } = useFocus();
  const colors = useColors();
  if (!storageError) return null;
  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.notice,
        { backgroundColor: colors.accent, borderColor: colors.border },
      ]}
    >
      <Feather name="alert-circle" size={16} color={colors.destructive} />
      <Text style={[styles.noticeText, { color: colors.foreground }]}>
        {storageError}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  webPage: { paddingTop: 67, paddingBottom: 34 },
  pageContent: { paddingHorizontal: 22, paddingTop: 16, paddingBottom: 114, gap: 20 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headingCopy: { flex: 1, gap: 5 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 28, letterSpacing: -0.8 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  surface: { borderWidth: 1, borderRadius: 22, padding: 18, gap: 12 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase' },
  action: { minHeight: 48, paddingHorizontal: 18, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9 },
  actionText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  notice: { borderRadius: 14, borderWidth: 1, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 9 },
  noticeText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 17 },
});
