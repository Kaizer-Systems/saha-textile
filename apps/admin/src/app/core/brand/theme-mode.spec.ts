import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	applyThemeMode,
	DARK_CLASS,
	DARK_THEME_HREF,
	DARK_THEME_LINK_ID,
	savedThemeMode,
	THEME_STORAGE_KEY,
	ThemeModeStore,
} from './theme-mode';

const appRoot = resolve(__dirname, '../../../..');
const bootScript = readFileSync(resolve(appRoot, 'public/assets/js/theme-mode.js'), 'utf8');

const link = () => document.getElementById(DARK_THEME_LINK_ID) as HTMLLinkElement | null;
const loaded = () => link()?.dispatchEvent(new Event('load'));
const dark = () => document.body.classList.contains(DARK_CLASS);

afterEach(() => {
	link()?.remove();
	document.body.className = '';
	document.documentElement.removeAttribute('style');
	localStorage.clear();
	TestBed.resetTestingModule();
});

describe('applyThemeMode', () => {
	it('links the dark stylesheet, and marks the page only once it has arrived', () => {
		applyThemeMode(document, 'dark');
		expect(link()?.getAttribute('href')).toBe(DARK_THEME_HREF);
		expect(dark()).toBe(false);
		loaded();
		expect(dark()).toBe(true);
	});

	it('still switches when the file fails to download', () => {
		applyThemeMode(document, 'dark');
		link()?.dispatchEvent(new Event('error'));
		expect(dark()).toBe(true);
	});

	it('does not mark the page when light was chosen again while the file loaded', () => {
		applyThemeMode(document, 'dark');
		const pending = link();
		applyThemeMode(document, 'light');
		pending?.dispatchEvent(new Event('load'));
		expect(dark()).toBe(false);
		expect(link()).toBeNull();
	});

	it('takes over what the boot script did without linking twice', () => {
		applyThemeMode(document, 'dark');
		loaded();
		applyThemeMode(document, 'dark');
		expect(document.querySelectorAll(`#${DARK_THEME_LINK_ID}`)).toHaveLength(1);
		expect(dark()).toBe(true);
	});

	it('light removes the class and the stylesheet', () => {
		applyThemeMode(document, 'dark');
		loaded();
		applyThemeMode(document, 'light');
		expect(dark()).toBe(false);
		expect(link()).toBeNull();
	});
});

describe('savedThemeMode', () => {
	it('reads dark, and treats anything else or refused storage as light', () => {
		expect(savedThemeMode(document)).toBe('light');
		localStorage.setItem(THEME_STORAGE_KEY, 'dark');
		expect(savedThemeMode(document)).toBe('dark');
		localStorage.setItem(THEME_STORAGE_KEY, 'purple');
		expect(savedThemeMode(document)).toBe('light');
		const refusing = {
			defaultView: {
				localStorage: {
					getItem: () => {
						throw new Error('denied');
					},
				},
			},
		} as unknown as Document;
		expect(savedThemeMode(refusing)).toBe('light');
	});
});

describe('ThemeModeStore', () => {
	it('starts from this browser’s choice and applies it', () => {
		localStorage.setItem(THEME_STORAGE_KEY, 'dark');
		const store = TestBed.inject(ThemeModeStore);
		TestBed.tick();
		expect(store.dark()).toBe(true);
		expect(link()).not.toBeNull();
	});

	it('toggles, remembers, and applies', () => {
		const store = TestBed.inject(ThemeModeStore);
		TestBed.tick();
		store.toggle();
		TestBed.tick();
		loaded();
		expect([store.mode(), localStorage.getItem(THEME_STORAGE_KEY), dark()]).toEqual(['dark', 'dark', true]);
		store.toggle();
		TestBed.tick();
		expect([store.mode(), localStorage.getItem(THEME_STORAGE_KEY), dark()]).toEqual(['light', 'light', false]);
	});

	it('picks the Brand Kit’s dark picture only in dark mode, and only when there is one', () => {
		const store = TestBed.inject(ThemeModeStore);
		expect(store.pick('light.png', 'dark.png')).toBe('light.png');
		store.toggle();
		expect(store.pick('light.png', 'dark.png')).toBe('dark.png');
		expect(store.pick('light.png', null)).toBe('light.png');
		expect(store.pick(undefined, undefined)).toBeNull();
	});

	it('still switches when the browser refuses storage', () => {
		const store = TestBed.inject(ThemeModeStore);
		const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('denied');
		});
		store.toggle();
		expect(store.dark()).toBe(true);
		setItem.mockRestore();
	});

	it('follows a switch made in another admin tab, and stops listening when destroyed', () => {
		const store = TestBed.inject(ThemeModeStore);
		window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }));
		expect(store.dark()).toBe(true);
		window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: 'light' }));
		expect(store.dark()).toBe(true);
		window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: null }));
		expect(store.dark()).toBe(false);
		TestBed.resetTestingModule();
		window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }));
		expect(store.dark()).toBe(false);
	});
});

describe('the boot script (public/assets/js/theme-mode.js)', () => {
	/** Runs the script as the browser would, against this test page. */
	const boot = () => new Function(bootScript)();

	it('uses the same key, file, link and class as the app', () => {
		expect(bootScript).toContain(`'${THEME_STORAGE_KEY}'`);
		expect(bootScript).toContain(`'${DARK_THEME_HREF}'`);
		expect(bootScript).toContain(`'${DARK_THEME_LINK_ID}'`);
		expect(bootScript).toContain(`'${DARK_CLASS}'`);
	});

	it('paints the page in the dark stylesheet’s own body colour until it loads', () => {
		const darkSheet = resolve(appRoot, 'public/assets/css/theme-dark.gen.css');
		const colour = /body\.dark-only \{[^}]*background-color: (#[0-9a-f]+)/.exec(
			readFileSync(darkSheet, 'utf8'),
		)?.[1];
		expect(colour).toBeTruthy();
		expect(bootScript).toContain(`'${colour}'`);
	});

	it('does nothing in light mode', () => {
		boot();
		expect(link()).toBeNull();
		expect(dark()).toBe(false);
	});

	it('links the stylesheet render-blocking, marks the body, and clears the stand-in colour on load', () => {
		localStorage.setItem(THEME_STORAGE_KEY, 'dark');
		boot();
		expect(link()?.getAttribute('blocking')).toBe('render');
		expect(dark()).toBe(true);
		expect(document.documentElement.style.backgroundColor).not.toBe('');
		loaded();
		expect(document.documentElement.style.backgroundColor).toBe('');
	});

	it('waits for <body> when it runs from <head>', async () => {
		localStorage.setItem(THEME_STORAGE_KEY, 'dark');
		const body = document.body;
		body.remove();
		boot();
		document.documentElement.appendChild(body);
		await Promise.resolve();
		expect(dark()).toBe(true);
	});

	it('does nothing when storage is refused', () => {
		const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('denied');
		});
		boot();
		expect(link()).toBeNull();
		getItem.mockRestore();
	});
});
