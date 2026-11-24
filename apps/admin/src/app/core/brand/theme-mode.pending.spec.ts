import { afterEach, describe, expect, it } from 'vitest';

import { DARK_CLASS, DARK_THEME_LINK_ID, applyThemeMode } from './theme-mode';

describe('dark chosen twice while its stylesheet is still on its way', () => {
	afterEach(() => {
		document.getElementById(DARK_THEME_LINK_ID)?.remove();
		document.body.classList.remove(DARK_CLASS);
	});

	it('keeps the one link and marks the page when it arrives', () => {
		applyThemeMode(document, 'dark');
		applyThemeMode(document, 'dark');
		const links = document.querySelectorAll(`#${DARK_THEME_LINK_ID}`);
		expect(links).toHaveLength(1);
		expect(document.body.classList.contains(DARK_CLASS)).toBe(false);
		links[0]?.dispatchEvent(new Event('load'));
		expect(document.body.classList.contains(DARK_CLASS)).toBe(true);
	});
});
