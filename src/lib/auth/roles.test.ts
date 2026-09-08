import type { UserRole } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { canWriteSharedData, resolveInitialRole } from './roles'

const ROLES: UserRole[] = ['OWNER', 'MEMBER']

describe('canWriteSharedData', () => {
  it('allows OWNER and refuses MEMBER', () => {
    expect(canWriteSharedData('OWNER')).toBe(true)
    expect(canWriteSharedData('MEMBER')).toBe(false)
  })

  it('grants the privilege to exactly one role', () => {
    // The shared Instrument and Candle tables feed every user's P&L
    // arithmetic. This being a single-role privilege is the point of it, and
    // if a role is ever added this fails until someone decides where it sits.
    expect(ROLES.filter(canWriteSharedData)).toEqual(['OWNER'])
  })
})

describe('resolveInitialRole', () => {
  it('makes the very first account the owner', () => {
    // Whoever sets the instance up needs to be able to administer it.
    expect(resolveInitialRole({ email: 'a@b.c', ownerEmails: [], isFirstUser: true })).toBe('OWNER')
  })

  it('makes every subsequent account a member', () => {
    // The regression this exists for: registerUser hardcoded OWNER and the
    // column defaulted to OWNER, so with open registration every stranger
    // who signed up became an instance owner.
    expect(resolveInitialRole({ email: 'a@b.c', ownerEmails: [], isFirstUser: false })).toBe('MEMBER')
  })

  it('promotes an address named in AUTH_OWNER_EMAILS', () => {
    expect(
      resolveInitialRole({ email: 'admin@example.com', ownerEmails: ['admin@example.com'], isFirstUser: false }),
    ).toBe('OWNER')
  })

  it('matches the named address case-insensitively and ignores surrounding space', () => {
    expect(
      resolveInitialRole({ email: '  Admin@Example.COM ', ownerEmails: ['admin@example.com'], isFirstUser: false }),
    ).toBe('OWNER')
  })

  it('does not promote an address that merely resembles a named one', () => {
    expect(
      resolveInitialRole({ email: 'admin@example.com.evil.test', ownerEmails: ['admin@example.com'], isFirstUser: false }),
    ).toBe('MEMBER')
    expect(
      resolveInitialRole({ email: 'notadmin@example.com', ownerEmails: ['admin@example.com'], isFirstUser: false }),
    ).toBe('MEMBER')
  })

  it('handles several named owners', () => {
    const ownerEmails = ['a@x.test', 'b@x.test']
    expect(resolveInitialRole({ email: 'b@x.test', ownerEmails, isFirstUser: false })).toBe('OWNER')
    expect(resolveInitialRole({ email: 'c@x.test', ownerEmails, isFirstUser: false })).toBe('MEMBER')
  })
})
