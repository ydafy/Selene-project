const tseslint = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const prettierConfig = require('eslint-config-prettier');
const js = require('@eslint/js');
const globals = require('globals');
const reactHooks = require('eslint-plugin-react-hooks');
const { reactRefresh } = require('eslint-plugin-react-refresh');
const { existsSync, readdirSync, statSync } = require('node:fs');
const { dirname, join, posix, relative } = require('node:path');
const importX = require('eslint-plugin-import-x');
const checkFile = require('eslint-plugin-check-file');
const {
  createTypeScriptImportResolver,
} = require('eslint-import-resolver-typescript');

// Dependency rule of docs/conventions.md: shared/ and features/ never reach up
// into app/, and a feature never reaches into another feature. Zones are
// repository-relative and resolved from this file's directory (`basePath`),
// so ESLint gives the same result when run from an app directory.
const FRONTEND_SRC = 'apps/frontend/src';
const ADMIN_WEB_SRC = 'apps/admin-web/src';
const EDGE_FUNCTIONS = 'supabase/functions';
const ADMIN_WEB_FILES = ['apps/admin-web/**/*.{ts,tsx}'];
const FIX =
  'Compose it in the route (app/) or move the shared piece to shared/. See docs/conventions.md.';

// Top-level folder of a path relative to src/: `app`, `shared`,
// `features/<domain>`, or `.` for the files directly under src/. Same grouping
// as scripts/dev/alias-imports.ts, which converted these imports.
function topLevelFolder(srcPath, isDir) {
  const parts = srcPath.split('/');
  if (parts.length === 1) return isDir ? srcPath : '.';
  return parts[0] === 'features' ? parts.slice(0, 2).join('/') : parts[0];
}

// A relative import that leaves its top-level folder must use the `@/` alias.
// It resolves the path, so `../../payments/x` from inside features/payments
// stays allowed, and it also checks `export ... from` and `import()`.
function relativeImportOutsideFolder(src) {
  const srcDir = join(__dirname, src);
  return {
    meta: {
      type: 'suggestion',
      schema: [],
      messages: {
        useAlias:
          "'{{spec}}' leaves {{folder}}; import it as '@/{{target}}' (docs/conventions.md).",
      },
    },
    create(context) {
      const file = relative(srcDir, context.filename).replace(/\\/g, '/');
      if (file.startsWith('../')) return {};
      const folder = topLevelFolder(file, false);
      const check = (source) => {
        if (!source || typeof source.value !== 'string') return;
        const spec = source.value;
        if (!spec.startsWith('./') && !spec.startsWith('../')) return;
        const target = posix.normalize(posix.join(posix.dirname(file), spec));
        if (target.startsWith('../')) return;
        const abs = join(srcDir, target);
        const isDir =
          !target.includes('/') &&
          existsSync(abs) &&
          statSync(abs).isDirectory();
        if (topLevelFolder(target, isDir) === folder) return;
        context.report({
          node: source,
          messageId: 'useAlias',
          data: {
            spec,
            folder: folder === '.' ? 'src/' : `${folder}/`,
            target,
          },
        });
      };
      return {
        ImportDeclaration: (node) => check(node.source),
        ExportAllDeclaration: (node) => check(node.source),
        ExportNamedDeclaration: (node) => check(node.source),
        ImportExpression: (node) =>
          node.source.type === 'Literal' && check(node.source),
      };
    },
  };
}

function dependencyZones(src) {
  const featuresDir = join(__dirname, src, 'features');
  const features = existsSync(featuresDir)
    ? readdirSync(featuresDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : [];
  return [
    {
      target: `${src}/shared`,
      from: [`${src}/features`, `${src}/app`],
      message: `shared/ must not import features/ or app/. ${FIX}`,
    },
    {
      target: `${src}/features`,
      from: `${src}/app`,
      message: `features/ must not import app/ (routes). ${FIX}`,
    },
    ...features.map((feature) => ({
      target: `${src}/features/${feature}`,
      from: `${src}/features`,
      except: [`./${feature}`],
      message: `features/${feature} must not import another feature. ${FIX}`,
    })),
  ];
}

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
    // admin-web also runs the core JavaScript rules, minus the ones TypeScript
    // already checks (no-undef and others), as its own config did before #221.
    files: ADMIN_WEB_FILES,
    languageOptions: { globals: globals.browser },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs['flat/eslint-recommended'].rules,
    },
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
  { ...reactHooks.configs.flat.recommended, files: ADMIN_WEB_FILES },
  { ...reactRefresh.configs.vite(), files: ADMIN_WEB_FILES },
  {
    // Dependency rule between shared/, features/ and app/ (see dependencyZones).
    files: [`${FRONTEND_SRC}/**/*.{ts,tsx}`],
    plugins: {
      'import-x': importX,
    },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          project: join(__dirname, 'apps/frontend/tsconfig.json'),
        }),
      ],
    },
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        { zones: dependencyZones(FRONTEND_SRC), basePath: __dirname },
      ],
    },
  },
  {
    files: [`${ADMIN_WEB_SRC}/**/*.{ts,tsx}`],
    plugins: {
      'import-x': importX,
    },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          project: join(__dirname, 'apps/admin-web/tsconfig.app.json'),
        }),
      ],
    },
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        { zones: dependencyZones(ADMIN_WEB_SRC), basePath: __dirname },
      ],
    },
  },
  {
    files: [`${ADMIN_WEB_SRC}/**/*.{ts,tsx}`],
    plugins: {
      selene: {
        rules: {
          'relative-import-outside-folder':
            relativeImportOutsideFolder(ADMIN_WEB_SRC),
        },
      },
    },
    rules: {
      'selene/relative-import-outside-folder': 'error',
    },
  },
  {
    // admin-web file names follow the same rule.
    files: [`${ADMIN_WEB_SRC}/**/*.{ts,tsx}`],
    plugins: {
      'check-file': checkFile,
    },
    rules: {
      'check-file/filename-naming-convention': [
        'error',
        { '**/*.{ts,tsx}': 'KEBAB_CASE' },
        { ignoreMiddleExtensions: true },
      ],
    },
  },
  {
    // Edge Function file names follow the same rule (#252).
    files: [`${EDGE_FUNCTIONS}/**/*.ts`],
    plugins: {
      'check-file': checkFile,
    },
    rules: {
      'check-file/filename-naming-convention': [
        'error',
        { '**/*.ts': 'KEBAB_CASE' },
        { ignoreMiddleExtensions: true },
      ],
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
    files: [
      `${FRONTEND_SRC}/**/*.{js,jsx,ts,tsx}`,
      `${ADMIN_WEB_SRC}/**/*.{ts,tsx}`,
      `${EDGE_FUNCTIONS}/**/*.ts`,
    ],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'max-lines': [
        'warn',
        { max: 400, skipBlankLines: true, skipComments: true },
      ],
    },
  },
];
