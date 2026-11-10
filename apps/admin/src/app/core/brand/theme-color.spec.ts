import { afterEach, describe, expect, it } from 'vitest';

import { applyThemeColor, restoreThemeColor } from './theme-color';

const variable = () => document.documentElement.style.getPropertyValue('--theme-color');

afterEach(() => {
	document.documentElement.style.removeProperty('--theme-color');
	localStorage.clear();
});

describe('admin theme colour', () => {
	it('sets the theme variable and remembers it for the next start', () => {
		applyThemeColor(document, '#7b3fa0');
		expect(variable()).toBe('#7b3fa0');
		document.documentElement.style.removeProperty('--theme-color');
		restoreThemeColor(document);
		expect(variable()).toBe('#7b3fa0');
	});

	it('ignores anything that is not a colour', () => {
		applyThemeColor(document, 'red; background: url(x)');
		applyThemeColor(document, undefined);
		expect(variable()).toBe('');
		localStorage.setItem('st_admin_theme_color', 'nonsense');
		restoreThemeColor(document);
		expect(variable()).toBe('');
	});

	it('still applies when the browser refuses storage', () => {
		const page = {
			documentElement: document.documentElement,
			defaultView: {
				localStorage: {
					setItem: () => {
						throw new Error('denied');
					},
					getItem: () => {
						throw new Error('denied');
					},
				},
			},
		} as unknown as Document;
		applyThemeColor(page, '#112233');
		expect(variable()).toBe('#112233');
		restoreThemeColor(page);
		expect(variable()).toBe('#112233');
	});
});
