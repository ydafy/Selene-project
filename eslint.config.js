const tseslint = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const prettierConfig = require('eslint-config-prettier');
const { readdirSync } = require('node:fs');
const importX = require('eslint-plugin-import-x');
const checkFile = require('eslint-plugin-check-file');
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
  {
    // File names are kebab-case (docs/conventions.md, "File naming"). Route
    // files under app/ are excepted: Expo Router turns their names into URLs.
    files: [`${FRONTEND_SRC}/**/*.{js,jsx,ts,tsx}`],
    ignores: [`${FRONTEND_SRC}/app/**`],
    plugins: {
      'check-file': checkFile,
    },
    rules: {
      'check-file/filename-naming-convention': [
        'error',
        { '**/*.{js,jsx,ts,tsx}': 'KEBAB_CASE' },
        { ignoreMiddleExtensions: true },
      ],
    },
  },
  {
    // Size warning (#135): a file past 400 lines of code mixes concerns and is
    // hard to review. Tests are excluded; long test files are a list of cases.
    files: [`${FRONTEND_SRC}/**/*.{js,jsx,ts,tsx}`],
    ignores: [`${FRONTEND_SRC}/**/*.test.{ts,tsx}`],
    rules: {
      'max-lines': [
        'warn',
        { max: 400, skipBlankLines: true, skipComments: true },
      ],
    },
  },
];
