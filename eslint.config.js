const tseslint = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");
const prettierConfig = require("eslint-config-prettier");

module.exports = [
  {
    // Aplica a todos los archivos
    ignores: [
      "node_modules/",
      ".expo/",
      "dist/",
      "build/",
      "apps/frontend/ios/",
      "apps/frontend/android/",
      // AÑADE ESTAS LÍNEAS:
      "eslint.config.js",
      ".prettierrc.js",
    ],
  },
  {
    // Configuración para archivos TypeScript/JavaScript
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      globals: {
        node: true, // Es bueno añadir esto para que entienda 'require' y 'module'
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs["eslint-recommended"].rules,
      ...tseslint.configs.recommended.rules,
      ...prettierConfig.rules,
      "prettier/prettier": "off",
    },
  },
];
