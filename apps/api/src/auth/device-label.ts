/**
 * Builds a human-readable session device label from a User-Agent string.
 *
 * Browsers never expose MAC / hardware IDs — those must not be invented. Labels are
 * UA-derived (browser + OS + form factor) plus a short fingerprint of the UA hash so two
 * Chrome-on-macOS sessions stay distinguishable when revoking.
 *
 * Examples: `Chrome on macOS (Desktop) · a3f2c9de`, `Safari on iOS (iPhone) · 9c1bffff`,
 * `Cursor on macOS (Desktop) · deadbeef`.
 */
export function labelFromUserAgent(userAgent: string | undefined, userAgentHash: string | null): string {
	const ua = (userAgent ?? '').trim();
	if (!ua) return fallbackLabel(userAgentHash);

	const browser = detectBrowser(ua);
	const { os, form } = detectOsAndForm(ua);
	const short = shortHash(userAgentHash);
	const base = form ? `${browser} on ${os} (${form})` : `${browser} on ${os}`;
	return short ? `${base} · ${short}` : base;
}

/** True when a stored label should be rewritten from the current request UA. */
export function shouldBackfillDeviceLabel(existing: string | null | undefined, userAgent: string): boolean {
	const ua = userAgent.trim();
	if (!ua) return false;
	if (!existing) return true;
	if (/unknown/i.test(existing)) return true;
	// Older parser mistook Electron / Cursor webviews for Chrome.
	if (/Electron/i.test(ua) && /Chrome/i.test(existing) && !/Cursor|Embedded browser/i.test(existing)) {
		return true;
	}
	// Upgrade 4-hex suffixes to 8-hex without waiting for re-login.
	const suffix = existing.match(/·\s*([a-f0-9]+)$/i)?.[1];
	if (suffix && suffix.length < 8) return true;
	return false;
}

function fallbackLabel(userAgentHash: string | null): string {
	const short = shortHash(userAgentHash);
	return short ? `Unknown browser · ${short}` : 'Unknown browser';
}

function shortHash(hash: string | null): string {
	if (!hash) return '';
	const hex = hash.replace(/[^a-fA-F0-9]/g, '');
	return hex.slice(0, 8).toLowerCase() || '';
}

function detectBrowser(ua: string): string {
	// Order matters: Electron embeds Chrome; Edge/Opera include Chrome; Chrome includes Safari.
	if (/Cursor/i.test(ua)) return 'Cursor';
	if (/Electron/i.test(ua)) return 'Embedded browser';
	if (/Edg\//i.test(ua)) return 'Edge';
	if (/OPR\/|Opera/i.test(ua)) return 'Opera';
	if (/Firefox\//i.test(ua)) return 'Firefox';
	if (/CriOS\//i.test(ua)) return 'Chrome';
	if (/FxiOS\//i.test(ua)) return 'Firefox';
	if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) return 'Chrome';
	if (/Chromium\//i.test(ua)) return 'Chromium';
	if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return 'Safari';
	if (/SamsungBrowser\//i.test(ua)) return 'Samsung Internet';
	return 'Browser';
}

function detectOsAndForm(ua: string): { os: string; form: string | null } {
	if (/iPhone/i.test(ua)) return { os: 'iOS', form: 'iPhone' };
	if (/iPad/i.test(ua)) return { os: 'iPadOS', form: 'iPad' };
	if (/Android/i.test(ua)) {
		const form = /Mobile/i.test(ua) ? 'Phone' : 'Tablet';
		return { os: 'Android', form };
	}
	if (/Windows NT/i.test(ua)) return { os: 'Windows', form: 'Desktop' };
	if (/Mac OS X|Macintosh/i.test(ua)) return { os: 'macOS', form: 'Desktop' };
	if (/CrOS/i.test(ua)) return { os: 'ChromeOS', form: 'Desktop' };
	if (/Linux/i.test(ua)) return { os: 'Linux', form: 'Desktop' };
	return { os: 'Unknown OS', form: null };
}
