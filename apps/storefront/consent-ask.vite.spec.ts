import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { consentAskScript, withConsentAsk } from './consent-ask.vite';
import {
	CONSENT_ASK_CLASS,
	CONSENT_TAP_ATTRIBUTE,
	COOKIE_POLICY_VERSION,
} from './src/app/core/consent/cookie-catalogue';

/** Runs the head script against a page with these cookies; answers whether it marked the page. */
const run = (cookie: string, version = COOKIE_POLICY_VERSION) => {
	const classes = new Set<string>();
	const attributes = new Map<string, string>();
	const listeners: Array<{ type: string; listener: (event: unknown) => void; capture: boolean }> = [];
	runInNewContext(consentAskScript(version), {
		document: {
			cookie,
			documentElement: {
				classList: {
					add: (name: string) => classes.add(name),
					contains: (name: string) => classes.has(name),
				},
				hasAttribute: (name: string) => attributes.has(name),
				setAttribute: (name: string, value: string) => attributes.set(name, value),
			},
			addEventListener: (type: string, listener: (event: unknown) => void, capture: boolean) =>
				listeners.push({ type, listener, capture }),
		},
		JSON,
		decodeURIComponent,
	});
	/** A tap on an element with this id, inside or outside the box's buttons. */
	const tap = (id: string) => {
		const target = { closest: (selector: string) => (selector.split(',').includes(`#${id}`) ? { id } : null) };
		for (const entry of listeners) if (entry.type === 'click') entry.listener({ target });
	};
	return { classes, attributes, listeners, tap };
};
const marks = (cookie: string, version = COOKIE_POLICY_VERSION): boolean =>
	run(cookie, version).classes.has(CONSENT_ASK_CLASS);

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
		const html =
			'<!doctype html><html><head>\n\t\t<meta charset="utf-8" />\n\t\t<link rel="stylesheet" href="/a.css">';
		const out = withConsentAsk(html, '2026-11-10');
		expect(out.indexOf('<script>')).toBeGreaterThan(out.indexOf('charset'));
		expect(out.indexOf('<script>')).toBeLessThan(out.indexOf('stylesheet'));
		expect(out.match(/<script>/g)).toHaveLength(1);
		expect(withConsentAsk('<html><head><title>x</title>', 'v')).toContain('<head>\n\t\t<script>');
	});

	it("notes the first tap on one of the box's buttons while the page still asks, and nothing else", () => {
		const page = run('');
		expect(page.listeners).toEqual([expect.objectContaining({ type: 'click', capture: true })]);
		page.tap('some_link');
		expect(page.attributes.size).toBe(0);
		page.tap('cookie_accept_btn');
		page.tap('cookie_necessary_btn');
		expect(page.attributes.get(CONSENT_TAP_ATTRIBUTE)).toBe('cookie_accept_btn');
	});

	it('notes nothing once the box is awake, and listens for nothing for a visitor who decided', () => {
		const awake = run('');
		awake.classes.delete(CONSENT_ASK_CLASS);
		awake.tap('cookie_necessary_btn');
		expect(awake.attributes.size).toBe(0);
		expect(run(decision()).listeners).toEqual([]);
	});
});
