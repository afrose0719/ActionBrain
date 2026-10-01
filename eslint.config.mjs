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
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
