import { describe, expect, it } from "vitest";
import { formatInZone } from "./formatters";

describe("formatInZone", () => {
  // 2026-03-02T20:30Z is already Tuesday morning in Ulaanbaatar (UTC+8) but
  // still Monday afternoon in New York — the case toLocaleString() on a UTC
  // server gets wrong for both.
  const at = "2026-03-02T20:30:00.000Z";

  it("renders the wall-clock time in the given zone, not the host's", () => {
    expect(formatInZone(at, "Asia/Ulaanbaatar", "yyyy-MM-dd HH:mm")).toBe("2026-03-03 04:30");
    expect(formatInZone(at, "America/New_York", "yyyy-MM-dd HH:mm")).toBe("2026-03-02 15:30");
    expect(formatInZone(at, "UTC", "yyyy-MM-dd HH:mm")).toBe("2026-03-02 20:30");
  });

  it("accepts a Date as well as an ISO string", () => {
    expect(formatInZone(new Date(at), "Asia/Ulaanbaatar", "MMM d")).toBe("Mar 3");
  });
});
