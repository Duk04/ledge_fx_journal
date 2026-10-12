/**
 * Password reset and account deletion against Postgres. Mocked: the mail
 * provider (global fetch — the reset link is read out of the sent mail, as a
 * user would), request headers (no request here), and which auth features
 * are on (computed from env at import time).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { RedirectError, signInAs } from "../../../test/db/auth";
import { createAccount, createUser } from "../../../test/db/factories";
import { requestPasswordReset, resetPassword } from "./password-reset";
import { deleteMyAccount } from "./account-deletion";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7", host: "ledger.test" }),
  cookies: async () => {
    throw new Error("no cookies in db tests");
  },
}));

vi.mock("@/lib/auth-features", () => ({
  authFeatures: {
    passwordLogin: true,
    google: false,
    resend: false,
    registration: true,
    requireEmailVerification: false,
  },
}));

const fetchMock = vi.fn();

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** The raw token from the last reset mail sent to `email`. */
function tokenFromMail(email: string): string {
  const mails = fetchMock.mock.calls
    .map(([, init]) => JSON.parse((init as RequestInit).body as string) as { to: string; text: string })
    .filter((m) => m.to === email);
  const url = mails.at(-1)?.text.match(/https?:\/\/\S+/)?.[0];
  if (!url) throw new Error("no reset mail");
  return new URL(url).searchParams.get("token")!;
}

async function userWithPassword(password = "an-old-passphrase-1") {
  const user = await createUser();
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 4) } });
  return user;
}

async function expectRedirect(promise: Promise<unknown>, to: string) {
  await expect(promise).rejects.toBeInstanceOf(RedirectError);
  await promise.catch((err: RedirectError) => expect(err.to).toBe(to));
}

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("AUTH_URL", "https://ledger.test");
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(Response.json({ id: "email_1" }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("password reset", () => {
  it("answers the same for an unknown address, and mails nothing", async () => {
    const result = await requestPasswordReset(form({ email: "nobody-here@test.local" }));
    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the emailed link sets the password once, and signs every session out", async () => {
    const user = await userWithPassword();
    signInAs(user.id, new Date(Date.now() - 60_000));
    expect(await getCurrentUser()).not.toBeNull();

    expect(await requestPasswordReset(form({ email: user.email }))).toEqual({ ok: true });
    const token = tokenFromMail(user.email);
    // Only the hash is stored.
    const row = await prisma.verificationToken.findFirstOrThrow({ where: { identifier: `pwreset:${user.id}` } });
    expect(row.token).not.toBe(token);

    const next = "a-brand-new-passphrase-2";
    await expectRedirect(resetPassword(form({ token, password: next, confirm: next })), "/login?reset=1");
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare(next, updated.passwordHash!)).toBe(true);
    expect(await getCurrentUser()).toBeNull(); // the session issued before the reset is dead

    // Second use of the same link.
    const again = await resetPassword(
      form({ token, password: "yet-another-passphrase-3", confirm: "yet-another-passphrase-3" }),
    );
    expect(again.ok).toBe(false);
  });

  it("a weak or mismatched password costs a retype, not the link", async () => {
    const user = await userWithPassword();
    await requestPasswordReset(form({ email: user.email }));
    const token = tokenFromMail(user.email);

    const short = await resetPassword(form({ token, password: "short", confirm: "short" }));
    expect(short.ok).toBe(false);
    const differ = await resetPassword(
      form({ token, password: "a-brand-new-passphrase-2", confirm: "something-else-entirely" }),
    );
    expect(differ).toMatchObject({ ok: false, fieldErrors: { confirm: ["The two passwords don't match."] } });

    const good = "a-brand-new-passphrase-2";
    await expectRedirect(resetPassword(form({ token, password: good, confirm: good })), "/login?reset=1");
  });

  it("only the newest link works, and an expired one does not", async () => {
    const user = await userWithPassword();
    await requestPasswordReset(form({ email: user.email }));
    const first = tokenFromMail(user.email);
    await requestPasswordReset(form({ email: user.email }));
    const second = tokenFromMail(user.email);
    const p = "a-brand-new-passphrase-2";
    expect((await resetPassword(form({ token: first, password: p, confirm: p }))).ok).toBe(false);

    await prisma.verificationToken.updateMany({
      where: { identifier: `pwreset:${user.id}` },
      data: { expires: new Date(Date.now() - 1000) },
    });
    expect((await resetPassword(form({ token: second, password: p, confirm: p }))).ok).toBe(false);
  });

  it("is throttled per address after three requests an hour", async () => {
    const user = await userWithPassword();
    for (let i = 0; i < 3; i++) expect((await requestPasswordReset(form({ email: user.email }))).ok).toBe(true);
    expect((await requestPasswordReset(form({ email: user.email }))).ok).toBe(false);
  });
});

describe("deleteMyAccount", () => {
  it("needs the typed email and the right password, and then deletes everything", async () => {
    const password = "an-old-passphrase-1";
    const user = await userWithPassword(password);
    const account = await createAccount(user.id);
    await prisma.journalEntry.create({ data: { userId: user.id, entryDate: new Date("2026-03-04T00:00:00Z") } });
    signInAs(user.id);

    const wrongEmail = await deleteMyAccount(form({ confirmEmail: "someone@else.test", password }));
    expect(wrongEmail).toMatchObject({ ok: false, fieldErrors: { confirmEmail: [expect.any(String)] } });
    const wrongPassword = await deleteMyAccount(form({ confirmEmail: user.email, password: "nope" }));
    expect(wrongPassword).toMatchObject({ ok: false, fieldErrors: { password: [expect.any(String)] } });
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);

    await expectRedirect(
      deleteMyAccount(form({ confirmEmail: user.email.toUpperCase(), password })),
      "/login?deleted=1",
    );
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
    expect(await prisma.tradingAccount.count({ where: { id: account.id } })).toBe(0);
    expect(await prisma.journalEntry.count({ where: { userId: user.id } })).toBe(0);
  });

  it("without a password, requires a sign-in from the last ten minutes", async () => {
    const user = await createUser();
    signInAs(user.id, new Date(Date.now() - 30 * 60_000));
    const stale = await deleteMyAccount(form({ confirmEmail: user.email }));
    expect(stale).toMatchObject({ ok: false, formError: expect.stringContaining("ten minutes") });

    signInAs(user.id, new Date());
    await expectRedirect(deleteMyAccount(form({ confirmEmail: user.email })), "/login?deleted=1");
  });

  it("refuses to delete the last owner while other users remain", async () => {
    // Demote any owner other test files left behind, so this one is the last.
    await prisma.user.updateMany({ where: { role: "OWNER" }, data: { role: "MEMBER" } });
    const owner = await userWithPassword();
    await prisma.user.update({ where: { id: owner.id }, data: { role: "OWNER" } });
    await createUser();
    signInAs(owner.id);
    const result = await deleteMyAccount(form({ confirmEmail: owner.email, password: "an-old-passphrase-1" }));
    expect(result).toMatchObject({ ok: false, formError: expect.stringContaining("only instance owner") });
    expect(await prisma.user.count({ where: { id: owner.id } })).toBe(1);
  });
});
