/** Match private, tenant-scoped name rules without publishing member names in the app. */
export function normalizeTrialGuestName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60))
    .replace(/[\s\u200b-\u200d\u2060\ufeff・]+/g, "");
}

export function requiresMemberBooking(name: string, patterns: readonly string[]): boolean {
  const normalized = normalizeTrialGuestName(name);
  return patterns.some((pattern) => {
    const needle = normalizeTrialGuestName(pattern);
    return needle.length > 0 && normalized.includes(needle);
  });
}

/**
 * Private Edge secret: JSON mapping tenant IDs to name fragments. Never expose
 * this value in the browser, logs, a migration, or a Lovable agent prompt.
 * Missing/invalid optional configuration must not take ordinary bookings down.
 * Activation must be verified with check_only requests after setting the secret.
 */
export function getTrialMemberPatterns(raw: string | undefined, tenantId: string): readonly string[] {
  if (!raw) return [];
  try {
    const rules: unknown = JSON.parse(raw);
    if (!rules || typeof rules !== "object" || Array.isArray(rules)) throw new Error("invalid rules");
    if (!Object.prototype.hasOwnProperty.call(rules, tenantId)) return [];
    const patterns: unknown = (rules as Record<string, unknown>)[tenantId];
    if (!Array.isArray(patterns) || patterns.length > 50 ||
      !patterns.every((pattern) => typeof pattern === "string" && pattern.length <= 100)) {
      throw new Error("invalid patterns");
    }
    return patterns;
  } catch {
    // Deliberately omit the secret, tenant ID, and JSON parse error (PII).
    console.error("[trial-book] Invalid TRIAL_MEMBER_REDIRECT_RULES; member routing is inactive.");
    return [];
  }
}
