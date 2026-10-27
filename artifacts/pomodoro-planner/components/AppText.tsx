import React, { createContext, forwardRef, useContext } from 'react';
import {
  Platform, StyleSheet, Text, TextInput,
  type TextProps, type TextInputProps,
} from 'react-native';
import { fontStyleFor } from '@/utils/fontFallback';

export const FontAvailability = createContext(false);
const systemFamily = Platform.OS === 'android'
  ? 'sans-serif'
  : Platform.OS === 'ios' ? 'System' : 'system-ui';

export const AppText = forwardRef<Text, TextProps>(function AppText({ style, ...props }, ref) {
  const fontsLoaded = useContext(FontAvailability);
  return <Text {...props} ref={ref} style={fontStyleFor(StyleSheet.flatten(style), fontsLoaded, systemFamily)} />;
});

export const AppTextInput = forwardRef<TextInput, TextInputProps>(function AppTextInput({ style, ...props }, ref) {
  const fontsLoaded = useContext(FontAvailability);
  return <TextInput {...props} ref={ref} style={fontStyleFor(StyleSheet.flatten(style), fontsLoaded, systemFamily)} />;
});
