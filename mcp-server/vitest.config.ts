import { defineConfig } from "vitest/config";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from repo root (one level up from mcp-server/).
// process.loadEnvFile is available in Node 20.12+.
// Gracefully no-ops if the file doesn't exist.
try {
  process.loadEnvFile(resolve(__dirname, "../.env"));
} catch {
  // .env not present — integration tests will be skipped automatically
}

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
