import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { baseCurrencyOf, conversionNote, resolveConversion } from './conversion'

/**
 * This module's own header explains the stake: assume a rate of 1 for a
 * JPY-quoted trade in a USD account and the journal reports a $12,000 loss on
 * a trade that lost $85. It says that already happened once, in this
 * project's first data backfill.
 *
 * So what is asserted here is not only that the arithmetic is right, but that
 * the "I don't know" case is REACHED and FLAGGED rather than quietly
 * returning 1 — the contract being "the rate is either known or the trade is
 * flagged; it is never silently assumed".
 */

/** Minimal instrument shape, since resolveConversion only picks three fields. */
function instrument(symbol: string, quoteCurrency: string, baseCurrency: string | null = null) {
  return { symbol, quoteCurrency, baseCurrency }
}

describe('baseCurrencyOf', () => {
  it('prefers the stored baseCurrency', () => {
    expect(baseCurrencyOf(instrument('EURUSD', 'USD', 'EUR'))).toBe('EUR')
  })

  it('derives it from a 6-letter FX symbol', () => {
    expect(baseCurrencyOf(instrument('EURUSD', 'USD'))).toBe('EUR')
    expect(baseCurrencyOf(instrument('USDJPY', 'JPY'))).toBe('USD')
    expect(baseCurrencyOf(instrument('gbpaud', 'AUD'))).toBe('GBP')
  })

  it('returns null when the symbol is not a 6-letter pair', () => {
    // XAUUSD is six letters and would parse as "XAU", which is right; the
    // cases that must not guess are indices, crypto and anything vendor-named.
    expect(baseCurrencyOf(instrument('US30', 'USD'))).toBeNull()
    expect(baseCurrencyOf(instrument('NAS100', 'USD'))).toBeNull()
    expect(baseCurrencyOf(instrument('BTCUSDT', 'USDT'))).toBeNull()
    expect(baseCurrencyOf(instrument('SPX500', 'USD'))).toBeNull()
  })

  it('reads XAUUSD as XAU, which is the correct base for gold', () => {
    expect(baseCurrencyOf(instrument('XAUUSD', 'USD'))).toBe('XAU')
  })
})

describe('resolveConversion', () => {
  describe('IDENTITY — quote currency is the account currency', () => {
    it('returns exactly 1 for EURUSD in a USD account', () => {
      const r = resolveConversion({ instrument: instrument('EURUSD', 'USD', 'EUR'), accountCurrency: 'USD' })
      expect(r.source).toBe('IDENTITY')
      expect(r.rate.toString()).toBe('1')
      expect(r.needsAttention).toBe(false)
    })

    it('compares currencies case-insensitively', () => {
      const r = resolveConversion({ instrument: instrument('EURUSD', 'usd', 'EUR'), accountCurrency: 'Usd' })
      expect(r.source).toBe('IDENTITY')
    })
  })

  describe('INVERSE_PRICE — the account currency is the instrument base', () => {
    it('uses 1/price for USDJPY in a USD account', () => {
      // The case from the module header. At 150.00, one yen is worth
      // 1/150 = 0.00666… dollars, so a ¥12,750 result is $85 — not $12,750.
      const r = resolveConversion({
        instrument: instrument('USDJPY', 'JPY', 'USD'),
        accountCurrency: 'USD',
        referencePrice: '150.00',
      })
      expect(r.source).toBe('INVERSE_PRICE')
      expect(r.needsAttention).toBe(false)
      expect(new Decimal(12_750).times(r.rate).toDecimalPlaces(2).toString()).toBe('85')
    })

    it('derives the base from the symbol when the column is null', () => {
      const r = resolveConversion({
        instrument: instrument('USDJPY', 'JPY'),
        accountCurrency: 'USD',
        referencePrice: 150,
      })
      expect(r.source).toBe('INVERSE_PRICE')
    })

    it('accepts a Decimal, a string or a number as the reference price', () => {
      for (const price of [new Decimal('150'), '150', 150]) {
        const r = resolveConversion({
          instrument: instrument('USDJPY', 'JPY', 'USD'),
          accountCurrency: 'USD',
          referencePrice: price,
        })
        expect(r.rate.toDecimalPlaces(8).toString()).toBe('0.00666667')
      }
    })

    it('falls through to ASSUMED_ONE when there is no reference price', () => {
      // An open trade with no price yet must not silently become 1:1 — it has
      // to be flagged, which is the whole contract.
      const r = resolveConversion({ instrument: instrument('USDJPY', 'JPY', 'USD'), accountCurrency: 'USD' })
      expect(r.source).toBe('ASSUMED_ONE')
      expect(r.needsAttention).toBe(true)
    })

    it('falls through when the reference price is zero or negative', () => {
      for (const price of [0, '0', -150]) {
        const r = resolveConversion({
          instrument: instrument('USDJPY', 'JPY', 'USD'),
          accountCurrency: 'USD',
          referencePrice: price,
        })
        expect(r.source, String(price)).toBe('ASSUMED_ONE')
      }
    })
  })

  describe('EXPLICIT — the user said so', () => {
    it('wins over IDENTITY', () => {
      const r = resolveConversion({
        instrument: instrument('EURUSD', 'USD', 'EUR'),
        accountCurrency: 'USD',
        explicitRate: '0.9',
      })
      expect(r.source).toBe('EXPLICIT')
      expect(r.rate.toString()).toBe('0.9')
    })

    it('wins over INVERSE_PRICE', () => {
      const r = resolveConversion({
        instrument: instrument('USDJPY', 'JPY', 'USD'),
        accountCurrency: 'USD',
        explicitRate: 0.0068,
        referencePrice: 150,
      })
      expect(r.source).toBe('EXPLICIT')
      expect(r.rate.toString()).toBe('0.0068')
    })

    it('is ignored when empty, null or undefined, so the other rules still run', () => {
      for (const explicitRate of [null, undefined, '']) {
        const r = resolveConversion({
          instrument: instrument('EURUSD', 'USD', 'EUR'),
          accountCurrency: 'USD',
          explicitRate,
        })
        expect(r.source, String(explicitRate)).toBe('IDENTITY')
      }
    })

    it('is ignored when zero or negative — a rate of 0 would zero every P&L', () => {
      for (const explicitRate of [0, '0', -1]) {
        const r = resolveConversion({
          instrument: instrument('USDJPY', 'JPY', 'USD'),
          accountCurrency: 'USD',
          explicitRate,
          referencePrice: 150,
        })
        expect(r.source, String(explicitRate)).toBe('INVERSE_PRICE')
      }
    })
  })

  describe('ASSUMED_ONE — the case that must never be silent', () => {
    it('flags a cross pair in an unrelated account currency', () => {
      // EURJPY in a USD account: the rate involves neither leg of the pair,
      // so it cannot come from the trade's own price.
      const r = resolveConversion({
        instrument: instrument('EURJPY', 'JPY', 'EUR'),
        accountCurrency: 'USD',
        referencePrice: 160,
      })
      expect(r.source).toBe('ASSUMED_ONE')
      expect(r.rate.toString()).toBe('1')
      expect(r.needsAttention).toBe(true)
    })

    it('flags an index quoted in another currency', () => {
      const r = resolveConversion({
        instrument: instrument('GER40', 'EUR'),
        accountCurrency: 'USD',
        referencePrice: 18_000,
      })
      expect(r.source).toBe('ASSUMED_ONE')
      expect(r.needsAttention).toBe(true)
    })

    it('is the ONLY source that sets needsAttention', () => {
      const sources = [
        resolveConversion({ instrument: instrument('EURUSD', 'USD', 'EUR'), accountCurrency: 'USD' }),
        resolveConversion({
          instrument: instrument('USDJPY', 'JPY', 'USD'),
          accountCurrency: 'USD',
          referencePrice: 150,
        }),
        resolveConversion({
          instrument: instrument('EURUSD', 'USD', 'EUR'),
          accountCurrency: 'USD',
          explicitRate: 1.1,
        }),
      ]
      expect(sources.map((s) => s.needsAttention)).toEqual([false, false, false])
    })
  })
})

describe('conversionNote', () => {
  it('says nothing when the rate is exactly 1 by identity', () => {
    const r = resolveConversion({ instrument: instrument('EURUSD', 'USD', 'EUR'), accountCurrency: 'USD' })
    expect(conversionNote(r, { quoteCurrency: 'USD' }, 'USD')).toBeNull()
  })

  it('names both currencies and the rate for the derived case', () => {
    const r = resolveConversion({
      instrument: instrument('USDJPY', 'JPY', 'USD'),
      accountCurrency: 'USD',
      referencePrice: 150,
    })
    const note = conversionNote(r, { quoteCurrency: 'JPY' }, 'USD')
    expect(note).toContain('JPY')
    expect(note).toContain('USD')
    expect(note).toContain('0.006667')
  })

  it('asks for a rate, rather than reporting a number, when assuming 1', () => {
    // The message is the mitigation for the flagged case, so its content is
    // part of the contract: it must not read as though the P&L is correct.
    const r = resolveConversion({
      instrument: instrument('EURJPY', 'JPY', 'EUR'),
      accountCurrency: 'USD',
      referencePrice: 160,
    })
    const note = conversionNote(r, { quoteCurrency: 'JPY' }, 'USD')
    expect(note).toContain('1:1')
    expect(note).toMatch(/enter a conversion rate/i)
  })

  it('mentions that the rate was user-entered for the explicit case', () => {
    const r = resolveConversion({
      instrument: instrument('EURJPY', 'JPY', 'EUR'),
      accountCurrency: 'USD',
      explicitRate: '0.0064',
    })
    expect(conversionNote(r, { quoteCurrency: 'JPY' }, 'USD')).toMatch(/you entered/i)
  })
})
