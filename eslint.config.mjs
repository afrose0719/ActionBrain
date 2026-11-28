import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Next.js turns on only a handful of accessibility rules. This enables the whole recommended set, so problems
  // like an unlabeled form field or a clickable <div> fail the build. (The plugin itself is registered by Next.)
  { files: ["**/*.{ts,tsx}"], rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // not in "recommended": a button or link with no text and no aria-label is silent to a screen reader
      "jsx-a11y/control-has-associated-label": ["error", { ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"] }],
    },
  },
  // The Windows helper (desktop/) is a CommonJS Electron app: require() is how it loads Electron.
  { files: ["desktop/**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // vendored third-party engine copied here by scripts/copy-ort.mjs
    "public/ort/**",
    // the desktop helper's own dependencies and installer output
    "desktop/node_modules/**",
    "desktop/dist/**",
  ]),
]);

export default eslintConfig;
