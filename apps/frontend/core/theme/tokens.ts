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
  scrimLight: 'rgba(0,0,0,0.2)',
  backdrop: 'rgba(0,0,0,0.4)',
  scrimStrong: 'rgba(0,0,0,0.7)',
  nightFade: 'rgba(18,18,18,0.8)',
  glassGraySurface: 'rgba(30,30,30,0.3)',
  lionSubtle: 'rgba(189,159,101,0.15)',
  skeleton: 'rgba(255,255,255,0.08)',
  skeletonShimmer: 'rgba(255,255,255,0.5)',
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
  // Hairline borders and dividers.
  separator: palette.blueGray,
  // Barely raised fill for inactive cards and chips on the background.
  surfaceSubtle: palette.shadowDark,
  // Selected or highlighted fill, paired with a `primary` border.
  primarySubtle: palette.lionSubtle,
  // Translucent fill under a BlurView so the blur reads denser.
  glassSurface: palette.glassGraySurface,
  // Overlays on top of photos and content, from light to strong.
  scrimLight: palette.scrimLight,
  scrim: palette.scrim,
  scrimStrong: palette.scrimStrong,
  // Dims the screen behind menus and modals.
  backdrop: palette.backdrop,
  // End of a gradient that fades content into the background.
  backgroundFade: palette.nightFade,
  // Static and animated loading placeholders.
  skeleton: palette.skeleton,
  skeletonShimmer: palette.skeletonShimmer,
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
