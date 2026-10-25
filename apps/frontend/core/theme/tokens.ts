// Design tokens with no React Native imports, so they can be tested with `bun test`.
// `index.ts` builds the Restyle, React Native Paper, and navigation themes from them.

export const palette = {
  lion: '#bd9f65',
  blueLight: '#6f839f',
  platinum: '#E4E4E4',
  night: '#121212',
  stateGray: '#1E1E1E',
  forest: '#28a745',
  fire: '#dc3545',
  amber: '#f59e0b',
  shadowDark: 'rgba(255,255,255,0.03)',
  fireSubtle: '#dc35451a',
  blueGray: '#ffffff1a',
  glassGray: 'rgba(255,255,255,0.15)',
  black: '#0D0D0D',
  pureBlack: '#000000',

  scrim: 'rgba(0,0,0,0.6)',
  transparent: '#00000000',
  pending: '#A9924C',
  paid: '#5C85AD',
  preparing: '#7866A3',
  shipped: '#336084',
  delivered: '#478560',
  completed: '#319B5B',
  cancelled: '#6A3939',
  refunded: '#6A4D39',
  dispute: '#782B2B',
};

export const colors = {
  black: palette.black,
  background: palette.night,
  foreground: palette.platinum,
  primary: palette.lion,
  textPrimary: palette.platinum,
  textSecondary: palette.blueLight,
  cardBackground: palette.stateGray,
  pressableShadow: palette.shadowDark,
  blurBackground: palette.glassGray,

  // Caution foreground: icons, borders, and status dots.
  warning: palette.amber,
  // Soft background for error panels, paired with an `error` border or text.
  errorSubtle: palette.fireSubtle,
  focus: palette.scrim,
  // `shadowColor` for elevated surfaces; opacity comes from `shadowOpacity`.
  shadow: palette.pureBlack,
  // Behind full-screen photos and video, where any tint would show.
  mediaBackground: palette.pureBlack,
  success: palette.forest,
  error: palette.fire,
  separator: palette.blueGray,
  transparent: palette.transparent,
  // Order and shipment states
  pending: palette.pending,
  paid: palette.paid,
  preparing: palette.preparing,
  shipped: palette.shipped,
  delivered: palette.delivered,
  completed: palette.completed,
  cancelled: palette.cancelled,
  refunded: palette.refunded,
  dispute: palette.dispute,
};

export const spacing = { xs: 4, s: 8, m: 16, l: 24, xl: 40 };

export const borderRadii = {
  s: 8,
  m: 16,
  l: 24,
  xl: 40,
  full: 999, // Para círculos perfectos
};

// Paper multiplies roundness per component (Dialog x7, Chip x2), so app components
// that need an exact radius set it explicitly.
export const paperRoundness = borderRadii.s;
