// ESLint 9 "flat config". A single array of config objects applied top-to-bottom.
// Kept intentionally small: TypeScript recommended rules + a few project guards.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // 1. Ignore build output and dependencies everywhere.
  { ignores: ["**/dist/**", "**/node_modules/**", "**/*.config.*"] },

  // 2. Base JavaScript recommended rules.
  js.configs.recommended,

  // 3. TypeScript recommended rules (type-aware where a tsconfig is found).
  ...tseslint.configs.recommended,

  // 4. Project-wide overrides.
  {
    rules: {
      // Encourage explicit intent; warn (not error) so it never blocks a commit.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // `any` is a smell in a correctness-critical financial system.
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": "off",
    },
  },
);
