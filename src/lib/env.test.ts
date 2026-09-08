import { describe, expect, it } from 'vitest'
import { parseEnv } from './env'

/** A valid-but-minimal environment, to vary one field at a time from. */
function base(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://user:pw@localhost:5432/fx',
    AUTH_SECRET: 'x'.repeat(32),
    ...overrides,
  } as NodeJS.ProcessEnv
}

describe('parseEnv', () => {
  it('accepts a minimal development environment', () => {
    const env = parseEnv(base())
    expect(env.DATABASE_URL).toContain('postgresql://')
    expect(env.NODE_ENV).toBe('development')
  })

  describe('required values', () => {
    it('rejects a missing DATABASE_URL', () => {
      expect(() => parseEnv(base({ DATABASE_URL: undefined }))).toThrow(/DATABASE_URL/)
    })

    it('rejects a missing AUTH_SECRET', () => {
      // Previously nothing in app code read this at all: Auth.js checked it
      // internally, so a missing secret failed at the first request.
      expect(() => parseEnv(base({ AUTH_SECRET: undefined }))).toThrow(/AUTH_SECRET/)
    })

    it('rejects a short AUTH_SECRET', () => {
      expect(() => parseEnv(base({ AUTH_SECRET: 'too-short' }))).toThrow(/at least 32/)
    })

    it('accepts exactly 32 characters', () => {
      expect(() => parseEnv(base({ AUTH_SECRET: 'y'.repeat(32) }))).not.toThrow()
    })
  })

  describe('the .env.example placeholder secret', () => {
    const placeholder = 'dev-only-secret-change-me-in-production-0123456789'

    it('is allowed in development, so a fresh clone runs', () => {
      expect(() => parseEnv(base({ AUTH_SECRET: placeholder }))).not.toThrow()
    })

    it('is refused in production', () => {
      expect(() =>
        parseEnv(base({ NODE_ENV: 'production', AUTH_SECRET: placeholder, AUTH_URL: 'https://x.example' })),
      ).toThrow(/placeholder/)
    })
  })

  describe('ALLOW_DEV_LOGIN is rejected, not ignored', () => {
    it('fails when set at all, even to false', () => {
      // Ignoring it would leave a deployment believing it had disabled
      // password login when it had not.
      expect(() => parseEnv(base({ ALLOW_DEV_LOGIN: 'false' }))).toThrow(/ALLOW_PASSWORD_LOGIN/)
      expect(() => parseEnv(base({ ALLOW_DEV_LOGIN: 'true' }))).toThrow(/ALLOW_PASSWORD_LOGIN/)
    })

    it('is fine when absent', () => {
      expect(() => parseEnv(base())).not.toThrow()
    })
  })

  describe('production URL rules', () => {
    const prod = (overrides: Record<string, string | undefined>) =>
      parseEnv(base({ NODE_ENV: 'production', AUTH_SECRET: 'z'.repeat(40), ...overrides }))

    it('requires AUTH_URL', () => {
      expect(() => prod({})).toThrow(/AUTH_URL/)
    })

    it('requires https', () => {
      expect(() => prod({ AUTH_URL: 'http://ledger.example.com' })).toThrow(/https/)
    })

    it('allows http on localhost, for a production build run locally', () => {
      expect(() => prod({ AUTH_URL: 'http://localhost:3000' })).not.toThrow()
    })

    it('accepts an https origin', () => {
      expect(() => prod({ AUTH_URL: 'https://ledger.example.com' })).not.toThrow()
    })

    it('rejects a malformed AUTH_URL', () => {
      expect(() => prod({ AUTH_URL: 'not a url' })).toThrow(/AUTH_URL/)
    })
  })

  describe('Google OAuth must be all or nothing', () => {
    it('rejects an id with no secret', () => {
      expect(() => parseEnv(base({ AUTH_GOOGLE_ID: 'id' }))).toThrow(/AUTH_GOOGLE_SECRET/)
    })

    it('rejects a secret with no id', () => {
      expect(() => parseEnv(base({ AUTH_GOOGLE_SECRET: 'secret' }))).toThrow(/AUTH_GOOGLE_ID/)
    })

    it('accepts both', () => {
      expect(() => parseEnv(base({ AUTH_GOOGLE_ID: 'id', AUTH_GOOGLE_SECRET: 'secret' }))).not.toThrow()
    })

    it('treats an empty string as unset, which is what a .env file produces', () => {
      expect(() => parseEnv(base({ AUTH_GOOGLE_ID: '', AUTH_GOOGLE_SECRET: '' }))).not.toThrow()
    })
  })

  describe('email verification needs a mail provider', () => {
    it('rejects requiring verification with no Resend key', () => {
      // Otherwise nobody could ever verify, including the person who set it.
      expect(() => parseEnv(base({ REQUIRE_EMAIL_VERIFICATION: 'true' }))).toThrow(/AUTH_RESEND_KEY/)
    })

    it('accepts it with a key', () => {
      expect(() =>
        parseEnv(base({ REQUIRE_EMAIL_VERIFICATION: 'true', AUTH_RESEND_KEY: 're_123' })),
      ).not.toThrow()
    })
  })

  describe('booleans', () => {
    it.each([
      ['true', true],
      ['1', true],
      ['yes', true],
      ['on', true],
      ['false', false],
      ['0', false],
      ['no', false],
      ['off', false],
    ])('parses %s', (raw, expected) => {
      expect(parseEnv(base({ ALLOW_REGISTRATION: raw })).ALLOW_REGISTRATION).toBe(expected)
    })

    it('defaults password login and registration on, verification off', () => {
      const env = parseEnv(base())
      expect(env.ALLOW_PASSWORD_LOGIN).toBe(true)
      expect(env.ALLOW_REGISTRATION).toBe(true)
      expect(env.REQUIRE_EMAIL_VERIFICATION).toBe(false)
    })

    it('falls back to the default for an unparseable value', () => {
      expect(parseEnv(base({ ALLOW_REGISTRATION: 'maybe' })).ALLOW_REGISTRATION).toBe(true)
    })

    it('treats an empty string as unset', () => {
      expect(parseEnv(base({ ALLOW_REGISTRATION: '' })).ALLOW_REGISTRATION).toBe(true)
    })
  })

  describe('AUTH_OWNER_EMAILS', () => {
    it('splits, trims and lowercases', () => {
      const env = parseEnv(base({ AUTH_OWNER_EMAILS: ' Duk@Example.com , second@example.com ' }))
      expect(env.AUTH_OWNER_EMAILS).toEqual(['duk@example.com', 'second@example.com'])
    })

    it('is an empty list when unset', () => {
      expect(parseEnv(base()).AUTH_OWNER_EMAILS).toEqual([])
    })

    it('drops empty entries from a trailing comma', () => {
      expect(parseEnv(base({ AUTH_OWNER_EMAILS: 'a@b.c,' })).AUTH_OWNER_EMAILS).toEqual(['a@b.c'])
    })
  })

  describe('error reporting', () => {
    function messageFor(raw: NodeJS.ProcessEnv): string {
      try {
        parseEnv(raw)
        return ''
      } catch (err) {
        return err instanceof Error ? err.message : String(err)
      }
    }

    it('reports every missing field at once, not just the first', () => {
      // A misconfigured deploy should learn about all of them in one go.
      const message = messageFor({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)
      expect(message).toContain('DATABASE_URL')
      expect(message).toContain('AUTH_SECRET')
    })

    it('reports cross-field problems once the fields themselves are valid', () => {
      // zod runs `superRefine` only after the object shape parses, so the
      // cross-field rules (AUTH_URL required in production, Google
      // all-or-nothing, verification needs a mail key) cannot be reported in
      // the same pass as a missing DATABASE_URL. That ordering is right —
      // there is nothing useful to say about the relationship between fields
      // that are not there — but it means a badly broken environment takes
      // two passes to fully diagnose. Worth pinning so nobody "fixes" it.
      const message = messageFor(
        base({ NODE_ENV: 'production', AUTH_SECRET: 'q'.repeat(40), AUTH_GOOGLE_ID: 'id' }),
      )
      expect(message).toContain('AUTH_URL')
      expect(message).toContain('AUTH_GOOGLE_SECRET')
    })
  })

  it('defaults EMAIL_FROM rather than leaving it undefined', () => {
    expect(parseEnv(base()).EMAIL_FROM).toBe('journal@example.com')
    expect(parseEnv(base({ EMAIL_FROM: 'x@y.z' })).EMAIL_FROM).toBe('x@y.z')
  })
})
