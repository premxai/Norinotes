import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "data/**", "test-results/**", "packages/db/migrations/**", "apps/web/**", "apps/landing/**", "nori-pet/work/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["**/*.mjs"], languageOptions: { globals: { process: "readonly", console: "readonly" } } },
  // nori-pet: the player runs in the browser; its scripts run in Node 22 (fetch, FormData and friends are global there).
  {
    files: ["nori-pet/src/**/*.js"],
    languageOptions: {
      globals: Object.fromEntries([
        "window", "document", "localStorage", "matchMedia", "getComputedStyle", "fetch", "URL", "Image", "ResizeObserver",
        "performance", "requestAnimationFrame", "requestIdleCallback", "addEventListener", "removeEventListener",
        "setTimeout", "clearTimeout", "setInterval", "clearInterval",
      ].map((name) => [name, "readonly"])),
    },
  },
  {
    files: ["nori-pet/scripts/**/*.mjs"],
    languageOptions: { globals: Object.fromEntries(["Buffer", "URL", "Blob", "FormData", "Response", "fetch"].map((name) => [name, "readonly"])) },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
);
