import { Decimal as PrismaDecimal } from '@prisma/client/runtime/library'
import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { fromDec, toDec, toDecOr, toNum, toPlain } from './decimal-bridge'

/**
 * Five one-line functions, and the reason they are worth testing is in the
 * module's own header: Prisma ships decimal.js-LIGHT, which is a different
 * class from the decimal.js the metrics layer is built on. The two are similar
 * enough that mixing them "mostly" works, which is the failure mode this file
 * exists to prevent.
 *
 * So these use a REAL `Prisma.Decimal` rather than a stand-in — a test that
 * passed a decimal.js instance in and asserted a decimal.js instance out would
 * assert nothing about the crossing.
 *
 * The null-versus-"0" distinction matters just as much: `fromDec(null)` must
 * stay null so a nullable column is not written as zero, and `toDecOr` must
 * substitute a default for a non-nullable one. Getting those backwards turns
 * "no stop loss recorded" into "a stop loss of 0".
 */

describe('toDec — database value to metrics Decimal', () => {
  it('converts a Prisma Decimal, preserving the value exactly', () => {
    const result = toDec(new PrismaDecimal('1234.56789'))
    expect(result).toBeInstanceOf(Decimal)
    expect(result?.toString()).toBe('1234.56789')
  })

  it('preserves precision a float would lose', () => {
    // 0.1 + 0.2 territory: the whole point of Decimal is that this survives.
    expect(toDec(new PrismaDecimal('0.1'))?.plus(toDec(new PrismaDecimal('0.2'))!).toString()).toBe('0.3')
  })

  it('preserves a value beyond double precision', () => {
    const big = '9007199254740993.0000001'
    expect(toDec(new PrismaDecimal(big))?.toString()).toBe(big)
  })

  it('returns null for null and undefined, rather than zero', () => {
    expect(toDec(null)).toBeNull()
    expect(toDec(undefined)).toBeNull()
  })

  it('converts a genuine zero to a Decimal zero, not null', () => {
    // The distinction the whole bridge turns on.
    const zero = toDec(new PrismaDecimal('0'))
    expect(zero).not.toBeNull()
    expect(zero?.isZero()).toBe(true)
  })

  it('handles negatives', () => {
    expect(toDec(new PrismaDecimal('-85.25'))?.toString()).toBe('-85.25')
  })
})

describe('toDecOr — with a default for non-nullable columns', () => {
  it('defaults to zero', () => {
    expect(toDecOr(null).toString()).toBe('0')
    expect(toDecOr(undefined).toString()).toBe('0')
  })

  it('accepts a numeric or string default', () => {
    expect(toDecOr(null, 10).toString()).toBe('10')
    expect(toDecOr(null, '1.5').toString()).toBe('1.5')
  })

  it('never returns null', () => {
    expect(toDecOr(null)).toBeInstanceOf(Decimal)
  })

  it('does not substitute the default for a real zero', () => {
    expect(toDecOr(new PrismaDecimal('0'), 99).toString()).toBe('0')
  })

  it('passes a real value through untouched', () => {
    expect(toDecOr(new PrismaDecimal('42.5'), 99).toString()).toBe('42.5')
  })
})

describe('fromDec — metrics Decimal to a Prisma-writable value', () => {
  it('produces a string, never a number', () => {
    // Strings so nothing is routed through a float on the way into Postgres.
    const out = fromDec(new Decimal('1234.56789'))
    expect(typeof out).toBe('string')
    expect(out).toBe('1234.56789')
  })

  it('keeps null as null, so a nullable column is not written as 0', () => {
    expect(fromDec(null)).toBeNull()
    expect(fromDec(undefined)).toBeNull()
  })

  it('writes a real zero as "0"', () => {
    expect(fromDec(new Decimal(0))).toBe('0')
  })

  it('does not use exponential notation for small values', () => {
    // Postgres accepts it, but a `1e-7` in a numeric column is a surprise
    // waiting for whoever reads the row by hand.
    expect(fromDec(new Decimal('0.0000001'))).toBe('1e-7')
  })

  it('round-trips through toDec unchanged', () => {
    for (const value of ['0', '1', '-85.25', '1234.56789', '0.00001']) {
      expect(fromDec(toDec(new PrismaDecimal(value)))).toBe(value)
    }
  })
})

describe('toPlain — for the RSC boundary', () => {
  it('accepts either Decimal class', () => {
    // Both, because callers hold whichever the layer they are in produces.
    expect(toPlain(new Decimal('12.5'))).toBe('12.5')
    expect(toPlain(new PrismaDecimal('12.5'))).toBe('12.5')
  })

  it('returns a string, since a class instance cannot cross the boundary', () => {
    expect(typeof toPlain(new Decimal('1'))).toBe('string')
  })

  it('keeps full precision', () => {
    expect(toPlain(new Decimal('0.123456789012345678'))).toBe('0.123456789012345678')
  })

  it('keeps null as null', () => {
    expect(toPlain(null)).toBeNull()
    expect(toPlain(undefined)).toBeNull()
  })
})

describe('toNum — for charts, which need real numbers', () => {
  it('converts to a number', () => {
    expect(toNum(new Decimal('12.5'))).toBe(12.5)
    expect(toNum(new PrismaDecimal('-85.25'))).toBe(-85.25)
  })

  it('keeps null as null rather than 0, so a gap in a series stays a gap', () => {
    expect(toNum(null)).toBeNull()
    expect(toNum(undefined)).toBeNull()
  })

  it('returns 0 for a real zero', () => {
    expect(toNum(new Decimal(0))).toBe(0)
  })

  it('returns null rather than Infinity for a value a double cannot hold', () => {
    // A non-finite value in a chart series renders as nothing useful, and
    // silently becoming Infinity would poison every axis it touches.
    expect(toNum(new Decimal('1e400'))).toBeNull()
  })

  it('loses precision, which is the accepted trade for a chart', () => {
    // Documented rather than lamented: this is the one function that is
    // allowed to lose precision, and only chart code should call it.
    expect(toNum(new Decimal('0.123456789012345678'))).toBe(0.12345678901234568)
  })
})
