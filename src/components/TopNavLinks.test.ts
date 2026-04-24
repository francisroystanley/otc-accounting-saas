import { describe, expect, it } from "vitest";
import { isActive } from "@/components/TopNavLinks";

describe("isActive", () => {
  it("matches an exact pathname", () => {
    expect(isActive("/dashboard", "/dashboard")).toBe(true);
  });

  it("matches a subroute under the link's href", () => {
    expect(isActive("/dashboard/123", "/dashboard")).toBe(true);
  });

  it("does not match a sibling route that shares the same prefix", () => {
    expect(isActive("/dashboard-archive", "/dashboard")).toBe(false);
  });

  it("does not match an unrelated route", () => {
    expect(isActive("/upload", "/dashboard")).toBe(false);
  });

  it("does not match the root with a non-root link", () => {
    expect(isActive("/", "/dashboard")).toBe(false);
  });
});
