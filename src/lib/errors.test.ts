import { describe, expect, it } from 'vitest'
import { ForbiddenError, NotFoundError } from './errors'

describe('NotFoundError', () => {
  it('carries a name that action modules can match on', () => {
    const err = new NotFoundError('nope')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('NotFoundError')
    expect(err.message).toBe('nope')
  })

  it('has a default message that reveals nothing', () => {
    expect(new NotFoundError().message).toBe('Not found')
  })
})

describe('ForbiddenError', () => {
  it('is distinct from NotFoundError', () => {
    // The distinction is a judgement, not a nicety. NotFoundError is
    // deliberately what another user's row produces, so account ids are not
    // enumerable. ForbiddenError says "you are signed in and this is not
    // yours to change", which is only safe about data whose existence is
    // already public to every user — the shared Instrument and Candle tables.
    const forbidden = new ForbiddenError()
    expect(forbidden).toBeInstanceOf(Error)
    expect(forbidden).not.toBeInstanceOf(NotFoundError)
    expect(forbidden.name).toBe('ForbiddenError')
  })

  it('has a default message safe to show a user', () => {
    expect(new ForbiddenError().message).toMatch(/permission/i)
  })

  it('carries a caller-supplied reason', () => {
    expect(new ForbiddenError('Only the owner can do that.').message).toBe('Only the owner can do that.')
  })
})
