import { describe, expect, it } from "vitest";
import { sanitizeNextPath } from "@/lib/auth/redirects";

describe("sanitizeNextPath", () => {
  it("returns a plain relative path unchanged", () => {
    expect(sanitizeNextPath("/dashboard")).toBe("/dashboard");
  });

  it("returns a nested relative path unchanged", () => {
    expect(sanitizeNextPath("/documents/abc-123")).toBe("/documents/abc-123");
  });

  it("falls back to /dashboard when the input is null", () => {
    expect(sanitizeNextPath(null)).toBe("/dashboard");
  });

  it("falls back to /dashboard when the input is empty", () => {
    expect(sanitizeNextPath("")).toBe("/dashboard");
  });

  it("rejects a protocol-relative URL", () => {
    expect(sanitizeNextPath("//evil.example/path")).toBe("/dashboard");
  });

  it("rejects an absolute http URL", () => {
    expect(sanitizeNextPath("https://evil.example/path")).toBe("/dashboard");
  });

  it("rejects a javascript: scheme", () => {
    expect(sanitizeNextPath("javascript:alert(1)")).toBe("/dashboard");
  });

  it("rejects a path missing the leading slash", () => {
    expect(sanitizeNextPath("documents/123")).toBe("/dashboard");
  });
});
