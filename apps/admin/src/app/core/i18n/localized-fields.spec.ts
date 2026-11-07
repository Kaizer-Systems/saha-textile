import { FormControl, FormGroup } from '@angular/forms';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { focusField, gapsByLocale, LocalizedFields } from './localized-fields';

afterEach(() => {
	document.body.innerHTML = '';
	vi.useRealTimers();
});

const focused = (html: string, key: string) => {
	vi.useFakeTimers();
	document.body.innerHTML = html;
	focusField(document, key);
	vi.runAllTimers();
	return document.activeElement;
};

describe('language gaps', () => {
	it('names each empty field by its control', () => {
		const form = new FormGroup({ name: new FormControl('Silk'), note: new FormControl('') });
		const fields = new LocalizedFields(form, ['name', 'note'], ['note']);
		expect(fields.gaps('en')).toEqual([]);
		expect(fields.gaps('fr')).toEqual([{ key: 'name', label: 'name' }]);
	});

	it('builds one list per language', () => {
		expect(gapsByLocale((locale) => [{ key: locale, label: 'x' }])).toEqual({
			en: [{ key: 'en', label: 'x' }],
			fr: [{ key: 'fr', label: 'x' }],
		});
	});
});

describe('focusField', () => {
	it('finds a field by id', () => {
		expect(focused('<input id="a" />', 'a')?.id).toBe('a');
	});

	it('finds a control by name', () => {
		expect(focused('<textarea formcontrolname="note"></textarea>', 'note')?.tagName).toBe('TEXTAREA');
	});

	it('reaches the input inside a wrapper', () => {
		const active = focused('<div id="d"><input id="inner" /></div>', 'd');
		expect(active?.id).toBe('inner');
	});

	it('falls back to the element, and ignores a field that is not on the screen', () => {
		expect(focused('<button id="b"></button>', 'b')?.id).toBe('b');
		expect(focused('<input id="a" />', 'gone')?.tagName).toBe('BODY');
		expect(focused('<div id="d" tabindex="0"></div>', 'd')?.id).toBe('d');
	});
});
