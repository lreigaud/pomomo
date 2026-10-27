/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#23362B',
    tint: '#3E7552',

    // Core surfaces
    background: '#F7F7F1',
    foreground: '#23362B',

    // Cards / elevated surfaces
    card: '#FFFEFA',
    cardForeground: '#23362B',

    // Primary action color (buttons, links, active states)
    primary: '#3E7552',
    primaryForeground: '#ffffff',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#E8EEE8',
    secondaryForeground: '#304A38',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#E9EAE2',
    mutedForeground: '#7A847A',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#E2EDE1',
    accentForeground: '#304A38',

    // Destructive actions (delete, error states)
    destructive: '#B94D3C',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#E2E5DA',
    input: '#E2E5DA',
    terracotta: '#C96A4A',
  },
  dark: {
    text: '#F0F1E8',
    tint: '#9BC79E',
    background: '#17211A',
    foreground: '#F0F1E8',
    card: '#202D23',
    cardForeground: '#F0F1E8',
    primary: '#9BC79E',
    primaryForeground: '#18301F',
    secondary: '#29382C',
    secondaryForeground: '#E4EBDD',
    muted: '#2A382D',
    mutedForeground: '#A0AB9E',
    accent: '#2D4331',
    accentForeground: '#E3EDE0',
    destructive: '#E48671',
    destructiveForeground: '#311912',
    border: '#344237',
    input: '#344237',
    terracotta: '#E18B6E',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 20,
};

export default colors;
