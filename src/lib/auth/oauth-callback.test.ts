import { describe, expect, it, vi } from "vitest";
import { type OAuthCallbackPort, buildOAuthRedirectTo, resolveOAuthCallback } from "@/lib/auth/oauth-callback";

const makePort = (result: { ok: true } | { ok: false } = { ok: true }): OAuthCallbackPort => {
  return {
    exchangeCodeForSession: vi.fn().mockResolvedValue(result),
  };
};

const request = (query: string): Request => {
  return new Request(`https://example.com/auth/callback${query}`);
};

describe("resolveOAuthCallback", () => {
  it("redirects to /dashboard on successful code exchange with no next", async () => {
    const port = makePort({ ok: true });

    const target = await resolveOAuthCallback(request("?code=abc"), port);

    expect(target).toBe("/dashboard");
    expect(port.exchangeCodeForSession).toHaveBeenCalledWith("abc");
  });

  it("redirects to the sanitized next path on success", async () => {
    const port = makePort({ ok: true });

    const target = await resolveOAuthCallback(request("?code=abc&next=/documents/xyz"), port);

    expect(target).toBe("/documents/xyz");
  });

  it("strips an absolute next URL and falls back to /dashboard", async () => {
    const port = makePort({ ok: true });

    const target = await resolveOAuthCallback(request("?code=abc&next=https://evil.example"), port);

    expect(target).toBe("/dashboard");
  });

  it("strips a protocol-relative next URL and falls back to /dashboard", async () => {
    const port = makePort({ ok: true });

    const target = await resolveOAuthCallback(request("?code=abc&next=//evil.example"), port);

    expect(target).toBe("/dashboard");
  });

  it("routes to /login?error=oauth_failed when the provider returned an error", async () => {
    const port = makePort({ ok: true });

    const target = await resolveOAuthCallback(request("?error=access_denied&error_description=User+denied"), port);

    expect(target).toBe("/login?error=oauth_failed");
    expect(port.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("routes to /login?error=oauth_failed when code is missing", async () => {
    const port = makePort({ ok: true });

    const target = await resolveOAuthCallback(request(""), port);

    expect(target).toBe("/login?error=oauth_failed");
    expect(port.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("routes to /login?error=oauth_failed when code is empty", async () => {
    const port = makePort({ ok: true });

    const target = await resolveOAuthCallback(request("?code="), port);

    expect(target).toBe("/login?error=oauth_failed");
  });

  it("routes to /login?error=oauth_exchange_failed when the exchange fails", async () => {
    const port = makePort({ ok: false });

    const target = await resolveOAuthCallback(request("?code=abc"), port);

    expect(target).toBe("/login?error=oauth_exchange_failed");
  });

  it("prioritizes the provider error over a simultaneously present code param", async () => {
    const port = makePort({ ok: true });

    const target = await resolveOAuthCallback(request("?error=access_denied&code=abc"), port);

    expect(target).toBe("/login?error=oauth_failed");
    expect(port.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});

describe("buildOAuthRedirectTo", () => {
  it("uses the configured public base URL when available", () => {
    const url = buildOAuthRedirectTo({
      publicBaseUrl: "https://app.example.com",
      windowOrigin: "http://localhost:3000",
    });

    expect(url).toBe("https://app.example.com/auth/callback");
  });

  it("falls back to the window origin when no public base URL is set", () => {
    const url = buildOAuthRedirectTo({
      publicBaseUrl: null,
      windowOrigin: "http://127.0.0.1:3000",
    });

    expect(url).toBe("http://127.0.0.1:3000/auth/callback");
  });

  it("strips a trailing slash on the base URL", () => {
    const url = buildOAuthRedirectTo({
      publicBaseUrl: "https://app.example.com/",
      windowOrigin: "http://localhost:3000",
    });

    expect(url).toBe("https://app.example.com/auth/callback");
  });

  it("encodes a nextPath as a query param", () => {
    const url = buildOAuthRedirectTo({
      publicBaseUrl: "https://app.example.com",
      windowOrigin: "http://localhost:3000",
      nextPath: "/documents/abc 123",
    });

    expect(url).toBe("https://app.example.com/auth/callback?next=%2Fdocuments%2Fabc+123");
  });

  it("omits the next param when nextPath is empty", () => {
    const url = buildOAuthRedirectTo({
      publicBaseUrl: "https://app.example.com",
      windowOrigin: "http://localhost:3000",
      nextPath: "",
    });

    expect(url).toBe("https://app.example.com/auth/callback");
  });
});
