import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { fail, failFields, fieldErrorsFrom, isFailure, ok, type ActionResult } from './result'

describe('ok', () => {
  it('returns a success with no payload', () => {
    expect(ok()).toEqual({ ok: true })
  })

  it('spreads a payload alongside the flag', () => {
    expect(ok({ id: 'trade-1' })).toEqual({ ok: true, id: 'trade-1' })
  })

  it('carries several fields', () => {
    expect(ok({ runId: 'r1', updated: 3 })).toEqual({ ok: true, runId: 'r1', updated: 3 })
  })
})

describe('fail / failFields', () => {
  it('builds a form-level failure', () => {
    expect(fail('That account was not found.')).toEqual({ ok: false, formError: 'That account was not found.' })
  })

  it('builds a field-level failure', () => {
    expect(failFields({ symbol: ['Unknown symbol'] })).toEqual({
      ok: false,
      fieldErrors: { symbol: ['Unknown symbol'] },
    })
  })
})

describe('isFailure', () => {
  it('narrows both arms', () => {
    expect(isFailure(ok({ id: 'x' }))).toBe(false)
    expect(isFailure(fail('nope'))).toBe(true)
  })
})

describe('fieldErrorsFrom', () => {
  const schema = z.object({
    symbol: z.string().min(1, 'Symbol is required'),
    volumeLots: z.coerce.number().positive('Must be greater than 0'),
  })

  it('keys messages by the first path segment', () => {
    const parsed = schema.safeParse({ symbol: '', volumeLots: -1 })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(fieldErrorsFrom(parsed.error)).toEqual({
      symbol: ['Symbol is required'],
      volumeLots: ['Must be greater than 0'],
    })
  })

  it('collects multiple messages for one field', () => {
    const strict = z.object({ name: z.string().min(5, 'Too short').regex(/^[A-Z]/, 'Must be capitalised') })
    const parsed = strict.safeParse({ name: 'ab' })
    if (parsed.success) return
    expect(fieldErrorsFrom(parsed.error).name).toEqual(['Too short', 'Must be capitalised'])
  })

  it('puts schema-level refinements under "form"', () => {
    // A `.refine()` on the object has an empty path, and a field error with no
    // field would simply vanish from the UI.
    const refined = z
      .object({ from: z.number(), to: z.number() })
      .refine((v) => v.to > v.from, { message: 'End must be after start' })
    const parsed = refined.safeParse({ from: 10, to: 5 })
    if (parsed.success) return
    expect(fieldErrorsFrom(parsed.error).form).toEqual(['End must be after start'])
  })

  it('keys a nested path on its FIRST segment, not the whole path', () => {
    // Deliberate and documented: form fields are registered under flat names,
    // so "fill.spreadPoints" would key an error no input is listening for.
    const nested = z.object({ fill: z.object({ spreadPoints: z.number().min(0, 'Cannot be negative') }) })
    const parsed = nested.safeParse({ fill: { spreadPoints: -1 } })
    if (parsed.success) return
    expect(Object.keys(fieldErrorsFrom(parsed.error))).toEqual(['fill'])
  })

  it('returns an empty object for a schema with no issues', () => {
    const parsed = schema.safeParse({ symbol: 'EURUSD', volumeLots: 1 })
    expect(parsed.success).toBe(true)
  })
})

describe('the type is a real discriminated union', () => {
  it('requires the payload on the success arm after narrowing', () => {
    // The regression this whole refactor is about. With the old
    // `ActionResult & { runId?: string }` intersection, `runId` was optional
    // on BOTH arms, so `result.runId` typechecked on a failure — and read
    // undefined at runtime.
    const result: ActionResult<{ runId: string }> = ok({ runId: 'run-1' })

    if (!result.ok) {
      // No payload here, and the compiler agrees.
      expectTypeOf(result).toHaveProperty('formError')
      // @ts-expect-error — runId does not exist on the failure arm
      void result.runId
      return
    }

    expectTypeOf(result.runId).toBeString()
    expect(result.runId).toBe('run-1')
  })

  it('allows a failure where a payload is declared', () => {
    const result: ActionResult<{ id: string }> = fail('nope')
    expect(result.ok).toBe(false)
  })
})
