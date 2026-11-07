const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  { ignores: ["dist/**", ".expo/**"] },
  expoConfig,
  // Playwright requires an object destructure even for fixtures with no dependencies.
  { files: ["tests/**/*.mjs"], rules: { "no-empty-pattern": "off" } },
]);
