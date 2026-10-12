import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { scrubEvent } from "./sentry-options";

describe("scrubEvent", () => {
  it("drops request bodies, cookies, query strings and auth headers", () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: "https://ledger.example/trades/new",
        data: "notes=my+secret+edge&entryPrice=1.1",
        cookies: { "authjs.session-token": "x" },
        query_string: "q=EURUSD",
        headers: { cookie: "a=b", authorization: "Bearer t", "user-agent": "ua" },
      },
    } as ErrorEvent);

    expect(event.request?.data).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.query_string).toBeUndefined();
    expect(event.request?.headers).toEqual({ "user-agent": "ua" });
    expect(event.request?.url).toBe("https://ledger.example/trades/new");
  });

  it("keeps a user id but not their email", () => {
    const event = scrubEvent({ type: undefined, user: { id: "u1", email: "a@b.c" } } as ErrorEvent);
    expect(event.user).toEqual({ id: "u1" });
  });
});
