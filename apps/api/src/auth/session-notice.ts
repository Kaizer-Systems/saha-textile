/** How long the sign-in pages explain an emergency sign-out (the grace period's length). */
export const SESSION_NOTICE_DAYS = 30;

/**
 * The date to show when everyone was signed out by a key change after a leak (`SESSIONS_RESET_AT`,
 * written by `pnpm secrets:rotate -- <tier> --names csrf --no-grace`), or null once 30 days have
 * passed, for a date in the future, or when there is none. Release Path brief, owner 2026-11-23.
 */
export function recentSessionReset(resetAt: string | undefined, now = Date.now()): string | null {
	if (!resetAt) return null;
	const at = Date.parse(resetAt);
	if (!Number.isFinite(at) || at > now || now - at > SESSION_NOTICE_DAYS * 24 * 60 * 60 * 1000) return null;
	return new Date(at).toISOString().slice(0, 10);
}
