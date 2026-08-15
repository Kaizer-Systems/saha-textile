import { describe, expect, it } from 'vitest';

import { labelFromUserAgent, shouldBackfillDeviceLabel } from '../src/auth/device-label';

describe('labelFromUserAgent', () => {
	it('labels Chrome on macOS with an 8-char UA hash suffix', () => {
		const ua =
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
		expect(labelFromUserAgent(ua, 'a3f2c9deffff')).toBe('Chrome on macOS (Desktop) · a3f2c9de');
	});

	it('labels Safari on iPhone', () => {
		const ua =
			'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
		expect(labelFromUserAgent(ua, '9c1bffff')).toBe('Safari on iOS (iPhone) · 9c1bffff');
	});

	it('labels Edge without inventing a MAC address', () => {
		const ua =
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
		const label = labelFromUserAgent(ua, 'deadbeef');
		expect(label).toBe('Edge on Windows (Desktop) · deadbeef');
		expect(label.toLowerCase()).not.toMatch(/\bmac\b/);
	});

	it('labels Cursor / Electron distinctly instead of Chrome', () => {
		const cursorUa =
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Cursor/1.0.0 Chrome/128.0.6613.186 Electron/32.0.0 Safari/537.36';
		expect(labelFromUserAgent(cursorUa, 'abcdef01')).toBe('Cursor on macOS (Desktop) · abcdef01');

		const electronUa =
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.186 Electron/32.0.0 Safari/537.36';
		expect(labelFromUserAgent(electronUa, '11223344')).toBe('Embedded browser on macOS (Desktop) · 11223344');
	});

	it('falls back when UA is missing', () => {
		expect(labelFromUserAgent(undefined, 'abcd1234')).toBe('Unknown browser · abcd1234');
		expect(labelFromUserAgent('', null)).toBe('Unknown browser');
	});
});

describe('shouldBackfillDeviceLabel', () => {
	const chromeUa =
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
	const electronUa =
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Electron/32.0.0 Safari/537.36';

	it('backfills null and Unknown labels when UA is present', () => {
		expect(shouldBackfillDeviceLabel(null, chromeUa)).toBe(true);
		expect(shouldBackfillDeviceLabel('Unknown browser · abcd', chromeUa)).toBe(true);
	});

	it('backfills Chrome labels that were actually Electron', () => {
		expect(shouldBackfillDeviceLabel('Chrome on macOS (Desktop) · a3f2c9de', electronUa)).toBe(true);
	});

	it('backfills short 4-hex suffixes', () => {
		expect(shouldBackfillDeviceLabel('Chrome on macOS (Desktop) · a3f2', chromeUa)).toBe(true);
	});

	it('skips fresh 8-hex Chrome labels', () => {
		expect(shouldBackfillDeviceLabel('Chrome on macOS (Desktop) · a3f2c9de', chromeUa)).toBe(false);
	});

	it('skips when UA is empty', () => {
		expect(shouldBackfillDeviceLabel(null, '')).toBe(false);
	});
});
