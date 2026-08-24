import { describe, expect, it } from 'vitest'
import { isWeekend, marketSession, tradingWeekday } from './session'

function utc(dateStr: string): Date {
  return new Date(dateStr)
}

describe('marketSession boundaries', () => {
  // 2026-01-05 is a Monday (UTC) — a plain trading weekday to anchor all hour checks.
  it('07:00 UTC is LONDON (London opens; overlaps Tokyo but London takes precedence)', () => {
    expect(marketSession(utc('2026-01-05T07:00:00Z'))).toBe('LONDON')
  })

  it('11:59 UTC is still LONDON (overlap has not started yet)', () => {
    expect(marketSession(utc('2026-01-05T11:59:00Z'))).toBe('LONDON')
  })

  it('12:00 UTC is OVERLAP (London ∩ New York begins)', () => {
    expect(marketSession(utc('2026-01-05T12:00:00Z'))).toBe('OVERLAP')
  })

  it('16:00 UTC is NEW_YORK (London has just closed, overlap has ended)', () => {
    expect(marketSession(utc('2026-01-05T16:00:00Z'))).toBe('NEW_YORK')
  })

  it('20:59 UTC is still NEW_YORK', () => {
    expect(marketSession(utc('2026-01-05T20:59:00Z'))).toBe('NEW_YORK')
  })

  it('21:00 UTC is SYDNEY (New York has just closed, Sydney opens)', () => {
    expect(marketSession(utc('2026-01-05T21:00:00Z'))).toBe('SYDNEY')
  })

  it('a Saturday is OFFHOURS regardless of hour', () => {
    // 2026-01-03 is a Saturday.
    expect(marketSession(utc('2026-01-03T12:00:00Z'))).toBe('OFFHOURS')
    expect(marketSession(utc('2026-01-03T21:00:00Z'))).toBe('OFFHOURS')
  })

  it('a Sunday is also OFFHOURS', () => {
    // 2026-01-04 is a Sunday.
    expect(marketSession(utc('2026-01-04T15:00:00Z'))).toBe('OFFHOURS')
  })

  it('early UTC hours (e.g. 02:00) are TOKYO', () => {
    expect(marketSession(utc('2026-01-05T02:00:00Z'))).toBe('TOKYO')
  })
})

describe('isWeekend', () => {
  it('is true for Saturday and Sunday (UTC calendar day)', () => {
    expect(isWeekend(utc('2026-01-03T00:00:00Z'))).toBe(true)
    expect(isWeekend(utc('2026-01-04T23:59:00Z'))).toBe(true)
  })

  it('is false for a weekday', () => {
    expect(isWeekend(utc('2026-01-05T00:00:00Z'))).toBe(false)
  })
})

describe('tradingWeekday', () => {
  it('returns the weekday as observed in the given timezone, which can differ from UTC', () => {
    // 2026-01-05T23:30:00Z is Monday in UTC, but already Tuesday in UTC+8.
    expect(tradingWeekday(utc('2026-01-05T23:30:00Z'), 'UTC')).toBe('MONDAY')
    expect(tradingWeekday(utc('2026-01-05T23:30:00Z'), 'Asia/Ulaanbaatar')).toBe('TUESDAY')
  })
})
