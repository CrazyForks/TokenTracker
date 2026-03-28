/**
 * Distinguishes local CLI / NPX / embedded-app usage (loopback) from a public deployment hostname.
 * Used for default route (dashboard vs landing) and Home link targets.
 */
export function isLocalDashboardHost(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

/** Canonical path for the marketing landing page: local uses /landing so / stays the dashboard. */
export function getLandingPagePath(): string {
  return isLocalDashboardHost() ? "/landing" : "/";
}

/** Path to open the dashboard from marketing: loopback keeps `/` as dashboard; public deploy uses `/dashboard` while `/` stays landing. */
export function getDashboardEntryPath(): string {
  return isLocalDashboardHost() ? "/" : "/dashboard";
}
