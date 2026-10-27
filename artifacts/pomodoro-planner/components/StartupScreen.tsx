import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

type StartupScreenProps = {
  message: string;
  error?: string | null;
  onRetry?: () => void;
};

/** Deliberately uses system text and no icon/font assets. */
export function StartupScreen({ message, error, onRetry }: StartupScreenProps) {
  const colors = useColors();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }, Platform.OS === 'web' && styles.webInsets]} testID="startup-screen">
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.foreground }]}>pomomo</Text>
        {!error ? <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Loading pomomo" /> : null}
        <Text accessibilityRole={error ? 'alert' : 'text'} accessibilityLiveRegion="polite" style={[styles.message, { color: colors.mutedForeground }]}>
          {error ?? message}
        </Text>
        {error && onRetry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try loading again"
            onPress={onRetry}
            testID="retry-startup"
            style={[styles.retry, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Try again</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  webInsets: { paddingTop: 67, paddingBottom: 34 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 24, paddingHorizontal: 28 },
  title: { fontSize: 28, fontWeight: '700' },
  message: { fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 320 },
  retry: { minHeight: 48, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 16 },
  retryText: { fontSize: 15, fontWeight: '600' },
});
