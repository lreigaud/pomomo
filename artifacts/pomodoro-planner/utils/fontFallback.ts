import type { TextStyle } from 'react-native';

const interWeights: Record<string, TextStyle['fontWeight']> = {
  Inter_400Regular: '400',
  Inter_500Medium: '500',
  Inter_600SemiBold: '600',
  Inter_700Bold: '700',
};

export function fontStyleFor(
  style: TextStyle | undefined,
  fontsLoaded: boolean,
  systemFamily: string,
): TextStyle | undefined {
  if (fontsLoaded || !style?.fontFamily || !interWeights[style.fontFamily]) return style;
  return {
    ...style,
    fontFamily: systemFamily,
    fontWeight: style.fontWeight ?? interWeights[style.fontFamily],
  };
}
