import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { CONSENT_ASK_CLASS, COOKIE_POLICY_VERSION } from './src/app/core/consent/cookie-catalogue';
import { consentAskScript, withConsentAsk } from './consent-ask.vite';

/** Runs the head script against a page with these cookies; answers whether it marked the page. */
const marks = (cookie: string, version = COOKIE_POLICY_VERSION): boolean => {
	const classes = new Set<string>();
	runInNewContext(consentAskScript(version), {
		document: { cookie, documentElement: { classList: { add: (name: string) => classes.add(name) } } },
		JSON,
		decodeURIComponent,
	});
	return classes.has(CONSENT_ASK_CLASS);
};

const decision = (overrides: Record<string, unknown> = {}) =>
	`st_consent=${encodeURIComponent(
		JSON.stringify({
			id: 'c0ffee00-0000-4000-8000-000000000001',
			version: COOKIE_POLICY_VERSION,
			savedAt: '2026-11-17T00:00:00.000Z',
			categories: { functional: true, analytics: false, targeting: false, marketing: false, promotional: false },
			...overrides,
		}),
	)}`;

describe('cookie box drawn with the page (decision D1)', () => {
	it('asks a first-time visitor, before the first paint', () => {
		expect(marks('')).toBe(true);
		expect(marks('st_locale=bn; st_currency=INR')).toBe(true);
	});

	it('never asks a visitor who decided under the current policy', () => {
		expect(marks(decision())).toBe(false);
		expect(marks(`st_locale=en; ${decision()}; st_theme=dark`)).toBe(false);
	});

	it('asks again when the decision is for an older policy, or unreadable, as the shop does', () => {
		expect(marks(decision({ version: '2026-01-01' }))).toBe(true);
		expect(marks(decision({ id: '' }))).toBe(true);
		expect(marks('st_consent=%7Bnot-json')).toBe(true);
		expect(marks(`x${decision()}`)).toBe(true);
	});

	it('goes right after the charset line, before any stylesheet, once', () => {
		const html = '<!doctype html><html><head>\n\t\t<meta charset="utf-8" />\n\t\t<link rel="stylesheet" href="/a.css">';
		const out = withConsentAsk(html, '2026-11-10');
		expect(out.indexOf('<script>')).toBeGreaterThan(out.indexOf('charset'));
		expect(out.indexOf('<script>')).toBeLessThan(out.indexOf('stylesheet'));
		expect(out.match(/<script>/g)).toHaveLength(1);
		expect(withConsentAsk('<html><head><title>x</title>', 'v')).toContain('<head>\n\t\t<script>');
	});
});
