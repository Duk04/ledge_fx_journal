import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Without this, `@/…` imports resolve under `tsc` but fail under vitest, so
      // tests end up written with relative paths while the rest of the app uses the
      // alias. Same alias, one place.
      "@": fileURLToPath(new URL("./src", import.meta.url)),

      // `server-only` is a marker package whose default export is a bare
      // `throw`; it exists so that importing a server module from a client
      // component fails at build time. Outside an RSC graph — which is where
      // vitest runs — that throw fires on import and makes every module
      // marked server-only untestable. The package ships `empty.js` for
      // exactly this case, but does not list it as a subpath in `exports`, so
      // the resolver refuses `server-only/empty.js`. Hence our own stub, which
      // also does not depend on the internals of a package we do not control.
      "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: true,
    env: {
      // `src/lib/env.ts` validates the environment in module scope, so that a
      // misconfigured deployment fails at boot rather than on whichever
      // request first touches a missing variable. Tests have no real database
      // URL and no signing secret, and should not need one to exercise, say,
      // a pure metrics function that happens to sit in the same import graph.
      //
      // The validation RULES are still tested — `env.test.ts` calls
      // `parseEnv()` directly with fabricated environments, which is the
      // reason that function is exported separately from the singleton.
      SKIP_ENV_VALIDATION: "1",
    },
  },
});
