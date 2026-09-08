import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Without this, `@/…` imports resolve under `tsc` but fail under vitest, so
  // tests end up written with relative paths while the rest of the app uses the
  // alias. Same alias, one place.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true,
  },
})
