// Only accept relative, non-protocol-relative redirects. Blocks open-redirect via ?next=https://evil.example.
export const sanitizeNextPath = (raw: string | null): string => {
  if (raw === null || raw === "" || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/dashboard";
  }

  return raw;
};
