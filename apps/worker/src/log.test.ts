import { describe, expect, it } from "vitest";
import { createLogger, scrub } from "./log.js";

describe("logger", () => {
  it("writes one JSON line per event with a timestamp", () => {
    const lines: string[] = [];
    createLogger((l) => lines.push(l), () => new Date("2026-10-31T12:00:00Z")).info("job", { queue: "understand.job", ms: 12 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({ ts: "2026-10-31T12:00:00.000Z", level: "info", event: "job", queue: "understand.job", ms: 12 });
  });

  it("never logs secrets, codes or credentials in URLs", () => {
    const out = scrub({
      password: "hunter2", apiKey: "sk-123", verificationCode: "123456", code: "998877", sessionToken: "t",
      error: "connect failed for postgres://user:s3cret@db.example.com:5432/nori", nested: { authorization: "Bearer abc", ok: 1 },
    }) as Record<string, unknown>;
    expect(out).toMatchObject({ password: "[redacted]", apiKey: "[redacted]", verificationCode: "[redacted]", code: "[redacted]", sessionToken: "[redacted]", nested: { authorization: "[redacted]", ok: 1 } });
    expect(String(out.error)).toBe("connect failed for postgres://***@db.example.com:5432/nori");
    expect(JSON.stringify(out)).not.toMatch(/hunter2|sk-123|s3cret|123456|998877/);
  });

  it("truncates very long strings", () => {
    expect((scrub("x".repeat(1000)) as string).length).toBeLessThan(500);
  });
});
