const tseslint = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const prettierConfig = require('eslint-config-prettier');
const { readdirSync } = require('node:fs');
const importX = require('eslint-plugin-import-x');
const {
  createTypeScriptImportResolver,
} = require('eslint-import-resolver-typescript');

// Dependency rule of docs/conventions.md: shared/ and features/ never reach up
// into app/, and a feature never reaches into another feature. Zones are
// repository-relative; the config is loaded from the repository root.
const FRONTEND_SRC = 'apps/frontend/src';
const features = readdirSync(`${FRONTEND_SRC}/features`, {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const FIX =
  'Compose it in the route (app/) or move the shared piece to shared/. See docs/conventions.md.';

const dependencyZones = [
  {
    target: `${FRONTEND_SRC}/shared`,
    from: [`${FRONTEND_SRC}/features`, `${FRONTEND_SRC}/app`],
    message: `shared/ must not import features/ or app/. ${FIX}`,
  },
  {
    target: `${FRONTEND_SRC}/features`,
    from: `${FRONTEND_SRC}/app`,
    message: `features/ must not import app/ (routes). ${FIX}`,
  },
  ...features.map((feature) => ({
    target: `${FRONTEND_SRC}/features/${feature}`,
    from: `${FRONTEND_SRC}/features`,
    except: [`./${feature}`],
    message: `features/${feature} must not import another feature. ${FIX}`,
  })),
];

module.exports = [
  {
    // Aplica a todos los archivos
    ignores: [
      'node_modules/',
      '**/.expo/',
      '**/dist/',
      '**/build/',
      'apps/frontend/ios/',
      'apps/frontend/android/',
      // AÑADE ESTAS LÍNEAS:
      // Vendor skills installed with the skills CLI are not linted.
      '.agents/',
      'eslint.config.js',
      '.prettierrc.js',
    ],
  },
  {
    // Configuración para archivos TypeScript/JavaScript
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      globals: {
        node: true,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs['eslint-recommended'].rules,
      ...tseslint.configs.recommended.rules,
      ...prettierConfig.rules,
      'prettier/prettier': 'off',
    },
  },
  {
    // Dependency rule between shared/, features/ and app/ (see dependencyZones).
    files: [`${FRONTEND_SRC}/**/*.{ts,tsx}`],
    plugins: {
      'import-x': importX,
    },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          project: 'apps/frontend/tsconfig.json',
        }),
      ],
    },
    rules: {
      'import-x/no-restricted-paths': ['error', { zones: dependencyZones }],
    },
  },
];
