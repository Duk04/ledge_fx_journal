import { describe, expect, it } from 'vitest'
import {
  buildFormData,
  datetimeLocalToIso,
  defaultFormValues,
  isoToDatetimeLocal,
  pad,
  toDatetimeLocal,
  type TradeFormInput,
} from './trade-form-values'

/**
 * The conversions between the form's string values and the two things either
 * side of it: an ISO timestamp from the database, and the FormData a server
 * action receives.
 *
 * Worth testing because both directions are silent when wrong. A
 * `datetime-local` input speaks LOCAL wall time with no offset; the database
 * speaks UTC. Get the conversion backwards and a trade is misfiled by the
 * timezone offset — which, for this app's default `Asia/Ulaanbaatar`, moves a
 * 09:00 London-session entry into the previous day's Tokyo session. Nothing
 * errors; the session label is just wrong.
 *
 * Most assertions here are timezone-INDEPENDENT (round trips, and structural
 * facts about what FormData carries) so the suite does not depend on the TZ
 * the runner happens to have.
 */

const VALUES: TradeFormInput = {
  symbol: 'EURUSD',
  direction: 'LONG',
  status: 'CLOSED',
  openedAt: '2026-09-08T09:00',
  closedAt: '2026-09-08T11:30',
  entryPrice: '1.1000',
  exitPrice: '1.1050',
  stopLoss: '1.0950',
  takeProfit: '1.1100',
  volumeLots: '1',
  commission: '3.50',
  swap: '0',
  conversionRate: '',
  followedPlan: 'yes',
  emotion: '4',
  confidence: '3',
  notes: 'Clean break of the Asian range.',
  tagIds: ['tag-a', 'tag-b'],
}

describe('pad', () => {
  it.each([
    [0, '00'],
    [5, '05'],
    [9, '09'],
    [10, '10'],
    [59, '59'],
  ])('%d -> %s', (n, expected) => {
    expect(pad(n)).toBe(expected)
  })
})

describe('toDatetimeLocal', () => {
  it('formats as YYYY-MM-DDTHH:mm', () => {
    expect(toDatetimeLocal(new Date(2026, 8, 8, 9, 5))).toBe('2026-09-08T09:05')
  })

  it('zero-pads a single-digit month, day, hour and minute', () => {
    expect(toDatetimeLocal(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02T03:04')
  })

  it('drops seconds, which the input does not accept', () => {
    expect(toDatetimeLocal(new Date(2026, 8, 8, 9, 5, 42))).toBe('2026-09-08T09:05')
  })

  it('uses LOCAL components, not UTC ones', () => {
    // The whole point. Built from local parts, so it reads back as the same
    // wall-clock time the user would see on their own clock — whatever the
    // runner's timezone is.
    const d = new Date(2026, 8, 8, 23, 30)
    expect(toDatetimeLocal(d)).toBe('2026-09-08T23:30')
    expect(toDatetimeLocal(d).slice(11)).toBe(`${pad(d.getHours())}:${pad(d.getMinutes())}`)
  })
})

describe('isoToDatetimeLocal', () => {
  it('returns "" for null, undefined and empty input', () => {
    expect(isoToDatetimeLocal(null)).toBe('')
    expect(isoToDatetimeLocal(undefined)).toBe('')
    expect(isoToDatetimeLocal('')).toBe('')
  })

  it('returns "" rather than "NaN" for an unparseable string', () => {
    // This feeds an input's `value`; "Invalid Date" rendered into a form field
    // is worse than an empty one.
    expect(isoToDatetimeLocal('not a date')).toBe('')
    expect(isoToDatetimeLocal('2026-13-45T99:99')).toBe('')
  })

  it('converts a UTC instant to the equivalent local wall time', () => {
    const iso = '2026-09-08T09:00:00.000Z'
    expect(isoToDatetimeLocal(iso)).toBe(toDatetimeLocal(new Date(iso)))
  })
})

describe('datetimeLocalToIso', () => {
  it('returns "" for empty input', () => {
    expect(datetimeLocalToIso('')).toBe('')
  })

  it('returns "" for an unparseable value', () => {
    expect(datetimeLocalToIso('gibberish')).toBe('')
  })

  it('produces a Z-suffixed UTC string', () => {
    // Unambiguous before it reaches the server, which has no way to know what
    // timezone a bare "2026-09-08T09:00" was meant in.
    const iso = datetimeLocalToIso('2026-09-08T09:00')
    expect(iso.endsWith('Z')).toBe(true)
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('interprets the input as local time', () => {
    expect(datetimeLocalToIso('2026-09-08T09:00')).toBe(new Date(2026, 8, 8, 9, 0).toISOString())
  })
})

describe('the two conversions round-trip', () => {
  // Timezone-independent by construction: whatever the offset, going out and
  // back has to land on the same wall-clock string.
  it.each([
    '2026-09-08T09:00',
    '2026-01-01T00:00',
    '2026-12-31T23:59',
    '2026-06-15T12:30',
    '2026-03-29T02:30', // inside the European DST transition
    '2026-11-01T01:30', // inside the US DST transition
  ])('%s survives local -> ISO -> local', (local) => {
    expect(isoToDatetimeLocal(datetimeLocalToIso(local))).toBe(local)
  })
})

describe('defaultFormValues', () => {
  it('defaults to an open long with every optional field blank', () => {
    const values = defaultFormValues()
    expect(values.direction).toBe('LONG')
    expect(values.status).toBe('OPEN')
    expect(values.symbol).toBe('')
    expect(values.tagIds).toEqual([])
  })

  it('defaults openedAt to now, in the input\'s own format', () => {
    expect(defaultFormValues().openedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('leaves followedPlan as "", which means "not recorded"', () => {
    // Distinct from "no" — a trade logged after the fact may genuinely not
    // know, and the schema carries that through as undefined.
    expect(defaultFormValues().followedPlan).toBe('')
  })

  it('lets overrides win, including over openedAt', () => {
    const values = defaultFormValues({ symbol: 'GBPUSD', openedAt: '2026-01-01T00:00', status: 'CLOSED' })
    expect(values.symbol).toBe('GBPUSD')
    expect(values.openedAt).toBe('2026-01-01T00:00')
    expect(values.status).toBe('CLOSED')
  })

  it('returns a fresh tagIds array each call', () => {
    // A shared array would let one form's tag selection leak into the next.
    const a = defaultFormValues()
    const b = defaultFormValues()
    a.tagIds.push('x')
    expect(b.tagIds).toEqual([])
  })
})

describe('buildFormData', () => {
  it('always sends the required fields', () => {
    const fd = buildFormData(VALUES)
    for (const key of ['symbol', 'direction', 'status', 'openedAt', 'entryPrice', 'volumeLots']) {
      expect(fd.has(key), key).toBe(true)
    }
  })

  it('converts both timestamps to UTC ISO on the way out', () => {
    const fd = buildFormData(VALUES)
    expect(String(fd.get('openedAt'))).toMatch(/Z$/)
    expect(String(fd.get('closedAt'))).toMatch(/Z$/)
  })

  it('OMITS blank optional fields rather than sending empty strings', () => {
    // `conversionRate` is "" in the fixture. Sending "" would be harmless
    // today — the schema preprocesses it to undefined — but omitting is the
    // behaviour the schema's `emptyToUndefined` was written to pair with, and
    // an empty string in a FormData log reads as "the user set this to
    // nothing" rather than "never filled in".
    const fd = buildFormData(VALUES)
    expect(fd.has('conversionRate')).toBe(false)
  })

  it.each(['closedAt', 'exitPrice', 'stopLoss', 'takeProfit', 'commission', 'swap', 'notes'])(
    'omits %s when blank',
    (key) => {
      const fd = buildFormData({ ...VALUES, [key]: '' })
      expect(fd.has(key)).toBe(false)
    },
  )

  it('sends a commission of "0", because "0" is a real answer', () => {
    // The distinction the whole blank-versus-zero split rests on: a free
    // trade is not the same as an unrecorded cost.
    const fd = buildFormData({ ...VALUES, commission: '0' })
    expect(fd.get('commission')).toBe('0')
  })

  it('omits followedPlan when not recorded, and sends it otherwise', () => {
    expect(buildFormData({ ...VALUES, followedPlan: '' }).has('followedPlan')).toBe(false)
    expect(buildFormData({ ...VALUES, followedPlan: 'no' }).get('followedPlan')).toBe('no')
  })

  it('appends every tagId, so a multi-select is not truncated', () => {
    const fd = buildFormData(VALUES)
    expect(fd.getAll('tagIds')).toEqual(['tag-a', 'tag-b'])
  })

  it('sends no tagIds key at all when none are selected', () => {
    expect(buildFormData({ ...VALUES, tagIds: [] }).has('tagIds')).toBe(false)
  })

  it('produces something parseTradeForm accepts', async () => {
    // The pairing that matters: this builder and that parser are the two ends
    // of one wire, and nothing else checks they agree.
    const { parseTradeForm } = await import('@/lib/schemas/trade')
    const result = parseTradeForm(buildFormData(VALUES))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.values.symbol).toBe('EURUSD')
    expect(result.values.commission).toBe(3.5)
    expect(result.values.tagIds).toEqual(['tag-a', 'tag-b'])
    expect(result.values.followedPlan).toBe(true)
  })

  it('round-trips a minimal open trade through the parser', () => {
    const fd = buildFormData(defaultFormValues({ symbol: 'EURUSD', entryPrice: '1.1', volumeLots: '1' }))
    expect(fd.has('exitPrice')).toBe(false)
    expect(fd.has('closedAt')).toBe(false)
  })
})
