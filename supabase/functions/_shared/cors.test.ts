import { describe, expect, it } from "vitest";
import { isAllowedOrigin, parseAllowList } from "./cors.ts";

const list = parseAllowList(
  " https://rcg-project-c18f5.web.app , https://rcg-project-c18f5--*.web.app,http://localhost:5002",
);

describe("isAllowedOrigin", () => {
  it("accepts exact origins", () => {
    expect(isAllowedOrigin("https://rcg-project-c18f5.web.app", list)).toBe(true);
    expect(isAllowedOrigin("http://localhost:5002", list)).toBe(true);
  });

  it("accepts Firebase preview channels of this site only", () => {
    expect(isAllowedOrigin("https://rcg-project-c18f5--pr-12-a1b2c3d4.web.app", list)).toBe(true);
    expect(isAllowedOrigin("https://rcg-project-c18f5--candidate-9f8e7d.web.app", list)).toBe(true);
    expect(isAllowedOrigin("https://other-site--pr-1-abc.web.app", list)).toBe(false);
  });

  it("never lets the wildcard cross a dot, a slash or the scheme", () => {
    expect(isAllowedOrigin("https://rcg-project-c18f5--x.evil.example/.web.app", list)).toBe(false);
    expect(isAllowedOrigin("https://rcg-project-c18f5--a.b.web.app", list)).toBe(false);
    expect(isAllowedOrigin("http://rcg-project-c18f5--pr-1-abc.web.app", list)).toBe(false);
    expect(isAllowedOrigin("https://rcg-project-c18f5--.web.app", list)).toBe(false);
  });

  it("rejects a missing origin and lookalikes", () => {
    expect(isAllowedOrigin(null, list)).toBe(false);
    expect(isAllowedOrigin("https://rcg-project-c18f5.web.app.evil.example", list)).toBe(false);
    expect(isAllowedOrigin("http://localhost:5003", list)).toBe(false);
  });
});
