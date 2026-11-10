import { afterEach, describe, expect, it } from 'vitest';

import { applyThemeMode, DARK_THEME_HREF } from './theme-mode';

const darkLinks = () => document.head.querySelectorAll(`link[href="${DARK_THEME_HREF}"]`);

describe('applyThemeMode', () => {
	afterEach(() => applyThemeMode(document, 'light'));

	it('leaves a light page without the dark class or the dark stylesheet', () => {
		applyThemeMode(document, 'light');
		expect(document.documentElement.classList.contains('dark')).toBe(false);
		expect(darkLinks()).toHaveLength(0);
	});

	it('treats a missing mode as light', () => {
		applyThemeMode(document, undefined);
		expect(darkLinks()).toHaveLength(0);
	});

	it('adds the dark class and links the dark stylesheet once', () => {
		applyThemeMode(document, 'dark');
		applyThemeMode(document, 'dark');
		expect(document.documentElement.classList.contains('dark')).toBe(true);
		expect(darkLinks()).toHaveLength(1);
		expect((darkLinks()[0] as HTMLLinkElement).rel).toBe('stylesheet');
	});

	it('removes both when the mode turns back to light', () => {
		applyThemeMode(document, 'dark');
		applyThemeMode(document, 'light');
		expect(document.documentElement.classList.contains('dark')).toBe(false);
		expect(darkLinks()).toHaveLength(0);
	});
});
