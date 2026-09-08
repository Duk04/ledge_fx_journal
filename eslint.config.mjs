import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import importPlugin from "eslint-plugin-import";

/**
 * Note on what is NOT here: `eslint-config-prettier`. `eslint-config-next/
 * typescript` is typescript-eslint's `recommended` set, which contains no
 * stylistic rules, and `core-web-vitals` has none either — so there is nothing
 * for Prettier to conflict with and no reason for the extra dependency.
 *
 * `@typescript-eslint/no-explicit-any` is likewise absent because it is
 * already an error via `recommended`. That rule is why the `any` count in
 * this codebase is zero; it does not need re-declaring.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    // Everything except db.ts itself, which is the module that legitimately
    // constructs the singleton.
    files: ["src/**/*.{ts,tsx}"],
    // db.ts constructs the singleton; result.ts is where ActionResult is
    // DEFINED. Both are the modules their rules point everything else at.
    ignores: ["src/lib/db.ts", "src/lib/actions/result.ts"],
    plugins: { import: importPlugin },
    rules: {
      /**
       * One `ActionResult`, imported from `@/lib/actions/result`.
       *
       * The type was declared TEN times across the action modules: seven
       * byte-identical interfaces, one missing `fieldErrors`, one a proper
       * discriminated union, and one a different shape entirely. Nothing but
       * a convention stopped the eleventh — and the divergence was not
       * cosmetic. `backtests.ts`'s `ActionResult & { runId?: string }` made
       * `runId` optional on the FAILURE arm too, so `result.runId` typechecked
       * on a value that could never have one.
       */
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSInterfaceDeclaration[id.name='ActionResult']",
          message: "Import ActionResult from '@/lib/actions/result' rather than redeclaring it.",
        },
        {
          selector: "TSTypeAliasDeclaration[id.name='ActionResult']",
          message: "Import ActionResult from '@/lib/actions/result' rather than redeclaring it.",
        },
      ],

      /**
       * One Prisma client, one name. `src/lib/db.ts` owns the singleton;
       * constructing a second one opens a second connection pool, which on a
       * pooled Postgres (this app targets Supabase's pgbouncer) is how a
       * deployment runs out of connections under load.
       */
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@prisma/client",
              importNames: ["PrismaClient"],
              message: "Import { prisma } from '@/lib/db' — one singleton, one name.",
            },
          ],
        },
      ],

      // `import type` for type-only imports, so a type import can never keep
      // a server-only module in a client bundle's graph.
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
    },
  },

  /**
   * THE LAYER BOUNDARY.
   *
   * The architecture is `page -> queries/* -> db` and
   * `action -> actions/* -> db`. Until now the only thing enforcing it was
   * `server-only`'s runtime throw — a build error that says nothing about
   * what the intended shape is. Six files had drifted across it, including a
   * *component* (`risk-guard.tsx`) querying Prisma directly.
   *
   * SCOPE, and why it is narrower than it first looks:
   *
   * - Only `.tsx` files. A colocated `actions.ts` (as under `settings/`) is a
   *   server action, which is a legitimate `db` caller — the rule is about
   *   what RENDERS, not about which directory a file sits in.
   *
   * - Only `db.ts`, not `queries/*`. `import/no-restricted-paths` (2.32) does
   *   not distinguish a type import from a value one, and 29 component files
   *   legitimately import a DTO *type* from a query module: the server
   *   component fetches, the client component receives it as props and needs
   *   its shape. Blocking those would mean either 29 `any`s or moving every
   *   DTO to a parallel types module for no benefit. Importing the Prisma
   *   client is the thing that is actually wrong, and that is what this
   *   catches.
   */
  {
    files: ["src/components/**/*.tsx", "src/app/**/*.tsx"],
    plugins: { import: importPlugin },
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./src/components",
              from: "./src/lib/db.ts",
              message:
                "Components must not touch the database. Fetch in the page (a server component) and pass the result down as props.",
            },
            {
              target: "./src/app",
              from: "./src/lib/db.ts",
              message:
                "Pages go page -> queries/* -> db. Add a function to src/lib/queries/ instead of importing Prisma here.",
            },
          ],
        },
      ],
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
