import { describe, expect, it } from 'vitest'
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_CHARS, validatePassword } from './password'

/** Fine as a password: long enough, varied, not in the common list. */
const GOOD = 'harbour-lantern-92'

describe('validatePassword', () => {
  it('accepts a reasonable password', () => {
    expect(validatePassword(GOOD)).toEqual({ ok: true })
  })

  describe('length', () => {
    it(`rejects fewer than ${MIN_PASSWORD_CHARS} characters`, () => {
      const r = validatePassword('short1!x')
      expect(r.ok).toBe(false)
      expect(r).toHaveProperty('message', expect.stringContaining(String(MIN_PASSWORD_CHARS)))
    })

    it('accepts exactly the minimum', () => {
      expect(validatePassword('abcdefgh12')).toEqual({ ok: true })
    })
  })

  describe('bcrypt byte ceiling', () => {
    /**
     * bcrypt hashes at most 72 bytes and discards the rest silently, so two
     * different long passwords can hash identically. These assert the limit
     * is counted in BYTES, which is the part that is easy to get wrong.
     */
    it('accepts exactly 72 bytes of ASCII', () => {
      expect(validatePassword('a1b2'.padEnd(MAX_PASSWORD_BYTES, 'x'))).toEqual({ ok: true })
    })

    it('rejects 73 bytes of ASCII', () => {
      const r = validatePassword('a1b2'.padEnd(MAX_PASSWORD_BYTES + 1, 'x'))
      expect(r.ok).toBe(false)
      expect(r).toHaveProperty('message', expect.stringContaining('too long'))
    })

    it('rejects 19 emoji, which is 76 bytes despite being 19 characters', () => {
      const password = '\u{1F600}'.repeat(19)
      expect(password.length).toBeLessThan(MAX_PASSWORD_BYTES)
      const r = validatePassword(password)
      expect(r.ok).toBe(false)
      expect(r).toHaveProperty('message', expect.stringContaining('bytes'))
    })

    it('counts two-byte Cyrillic correctly', () => {
      // Mongolian Cyrillic is two bytes per character, so 37 characters is
      // the real ceiling — a passphrase in this app's own default locale
      // hits the limit at half the length an ASCII user would expect.
      const fits = 'нэвтрэххоригсайнүгбичих'.slice(0, 30)
      const tooLong = 'нэвтрэххоригсайнүгбичихнэвтрэххоригсайнүг'
      expect(new TextEncoder().encode(fits).length).toBeLessThanOrEqual(MAX_PASSWORD_BYTES)
      expect(new TextEncoder().encode(tooLong).length).toBeGreaterThan(MAX_PASSWORD_BYTES)
      expect(validatePassword(fits)).toEqual({ ok: true })
      expect(validatePassword(tooLong).ok).toBe(false)
    })
  })

  describe('common passwords', () => {
    it.each(['password123', 'PASSWORD123', 'Password1234', 'qwertyuiop', 'trading123', 'iloveyou'])(
      'rejects %s',
      (password) => {
        expect(validatePassword(password).ok).toBe(false)
      },
    )

    it('matches case-insensitively', () => {
      expect(validatePassword('PaSsWoRd123').ok).toBe(false)
    })
  })

  describe('email similarity', () => {
    it('rejects a password containing the email local part', () => {
      const r = validatePassword('dulguun-secret-1', { email: 'dulguun@example.com' })
      expect(r.ok).toBe(false)
      expect(r).toHaveProperty('message', expect.stringContaining('email'))
    })

    it('rejects a password contained by the email local part', () => {
      expect(validatePassword('dulguun.ga', { email: 'dulguun.ga@example.com' }).ok).toBe(false)
    })

    it('is case-insensitive about it', () => {
      expect(validatePassword('DULGUUN-secret-1', { email: 'dulguun@example.com' }).ok).toBe(false)
    })

    it('ignores very short local parts, which would match everything', () => {
      // A two-character local part appears inside almost any password; the
      // rule would reject valid choices for no security gain.
      expect(validatePassword('abcdefgh12', { email: 'ab@example.com' })).toEqual({ ok: true })
    })

    it('applies no email rule when no email is given', () => {
      expect(validatePassword(GOOD)).toEqual({ ok: true })
    })
  })

  describe('character variety', () => {
    it('rejects a single repeated character', () => {
      expect(validatePassword('aaaaaaaaaaaa').ok).toBe(false)
    })

    it('rejects too few distinct characters', () => {
      expect(validatePassword('abababababab').ok).toBe(false)
    })

    it('accepts four or more distinct characters', () => {
      expect(validatePassword('abcdabcdabcd')).toEqual({ ok: true })
    })
  })
})
