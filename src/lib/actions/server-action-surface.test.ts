import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Structural guards over the server-action surface, asserted against source
 * text rather than behaviour. No database, no mocks, no Next runtime.
 *
 * These exist because of a class of mistake that is invisible in review: in
 * Next.js, EVERY export of a module whose first statement is `"use server"`
 * becomes a callable POST endpoint. Not just the ones a component imports —
 * every one, including a helper exported for no reason other than that it
 * felt tidy. Next's own data-security guide is explicit: "even if a Server
 * Action or utility function is not imported elsewhere in your code, it can
 * still be called externally."
 *
 * So an exported helper with no `requireUser()` is a public, unauthenticated
 * RPC endpoint, and nothing in the type system or the linter says so.
 */

const SRC = join(process.cwd(), 'src')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.tsx?$/.test(entry) ? [full] : []
  })
}

/** Path relative to the repo root, forward slashes, for readable failures. */
function rel(file: string): string {
  return relative(process.cwd(), file).split(sep).join(posix.sep)
}

/**
 * A module-scope `"use server"` is the first statement in the file. A
 * directive inside a function body (as `app/(auth)/login/page.tsx` uses, to
 * define an inline action next to the page that submits to it) marks only
 * that function and does NOT turn the module's other exports into endpoints.
 * Conflating the two produces false positives.
 */
function isModuleScopeUseServer(source: string): boolean {
  for (const raw of source.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue
    return line === '"use server";' || line === "'use server';"
  }
  return false
}

const actionModules = walk(SRC)
  .filter((f) => isModuleScopeUseServer(readFileSync(f, 'utf8')))
  .sort()

/**
 * Exports reachable without a session on purpose. Every name here is a
 * deliberate decision; anything else exported from a `"use server"` module
 * must authenticate.
 */
const UNAUTHENTICATED_BY_DESIGN = new Set([
  'signInWithPassword', // pre-session by definition
  'registerUser', // creates the session
  'signOutAction', // tearing a session down needs no session
])

const AUTH_FNS = ['requireUser', 'requireOwner', 'requireRole', 'requireVerifiedUser', 'requireAccountAccess']

/** Every top-level function in `source`, as name -> body text. */
function topLevelFunctions(source: string): Map<string, string> {
  const out = new Map<string, string>()
  const decl = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm
  const starts: { name: string; at: number }[] = []
  for (const m of source.matchAll(decl)) {
    starts.push({ name: m[1], at: m.index ?? 0 })
  }
  starts.forEach(({ name, at }, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : source.length
    out.set(name, source.slice(at, end))
  })
  return out
}

function callsAny(body: string, names: string[]): boolean {
  return names.some((n) => new RegExp(`\\b${n}\\s*\\(`).test(body))
}

describe('server action surface', () => {
  it('finds the action modules', () => {
    // A sanity check on the detector: if a refactor moves the actions and
    // this drops to zero, every assertion below would vacuously pass.
    expect(actionModules.length).toBeGreaterThanOrEqual(9)
    expect(actionModules.map(rel)).toContain('src/lib/actions/trades.ts')
  })

  describe.each(actionModules.map((f) => [rel(f), f] as const))('%s', (name, file) => {
    const source = readFileSync(file, 'utf8')
    const exportLines = source
      .split('\n')
      .map((line, i) => [line, i + 1] as const)
      .filter(([line]) => /^export\s/.test(line))

    it('exports only async functions and types', () => {
      const offenders = exportLines
        .filter(([line]) => !/^export\s+(async\s+function|type|interface)\b/.test(line))
        .map(([line, n]) => `${name}:${n}  ${line.trim()}`)

      // `export const`, sync `export function` and `export default` are all
      // errors here: Next can only assign an action id to an async function.
      expect(offenders).toEqual([])
    })

    it('authenticates in every exported action', () => {
      const fns = topLevelFunctions(source)

      // Several modules funnel their ownership check through a module-local
      // helper — accounts.ts's `accountOrError`, attachments.ts's
      // `ownedTrade`/`ownedAttachment`, strategies.ts's `strategyOrError`.
      // Calling one of those IS authenticating, so treat a call to a helper
      // that authenticates as equivalent to authenticating directly.
      const authenticatingHelpers = [...fns.entries()]
        .filter(([, body]) => callsAny(body, AUTH_FNS))
        .map(([fnName]) => fnName)

      const accepted = [...AUTH_FNS, ...authenticatingHelpers]

      const exported = exportLines
        .map(([line]) => /^export\s+async\s+function\s+(\w+)/.exec(line)?.[1])
        .filter((n): n is string => Boolean(n))
        .filter((n) => !UNAUTHENTICATED_BY_DESIGN.has(n))

      const unauthenticated = exported.filter((fnName) => {
        const body = fns.get(fnName)
        return body === undefined || !callsAny(body, accepted)
      })

      expect(unauthenticated).toEqual([])
    })
  })

  /**
   * The regression guard for the whole server-side-RCE fix.
   *
   * `compileStrategy` ends by INVOKING what `new Function` produced, so it
   * executes the author's top-level code in whatever process calls it. It
   * belongs in a browser Web Worker. It reached two server actions through
   * `@/lib/backtest`'s barrel, which is why the barrel no longer re-exports
   * `./sandbox` — but a barrel is a convention, and this is a test.
   */
  it('no server action reaches the strategy compiler', () => {
    const offenders = actionModules
      .filter((f) => {
        const source = readFileSync(f, 'utf8')
        // An import of, or a call to, compileStrategy — not a mention of the
        // name in a comment explaining why it is deliberately absent.
        const imported = /import\s[^;]*\bcompileStrategy\b/.test(source)
        const called = source
          .split('\n')
          .some((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && /\bcompileStrategy\s*\(/.test(line))
        return imported || called
      })
      .map(rel)

    expect(offenders).toEqual([])
  })

  it('the backtest barrel does not re-export the sandbox', () => {
    const barrel = readFileSync(join(SRC, 'lib/backtest/index.ts'), 'utf8')
    expect(barrel).not.toMatch(/from\s+["']\.\/sandbox["']/)
  })
})
