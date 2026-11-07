import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';

import { Subject } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { ACTIVE_LOCALE } from '@core/i18n/active-locale';

import { ConsentStore } from '@core/consent/consent.store';

import { Language } from './language';

const render = (locale = 'fr', protocol: string | null = 'https:', functional = true) => {
	const events = new Subject<unknown>();
	const doc = { cookie: '', location: protocol ? { protocol } : null };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: Router, useValue: { events, url: '/collections?page=2' } },
			{ provide: ACTIVE_LOCALE, useValue: locale },
			{ provide: ConsentStore, useValue: { allows: () => functional } },
		],
	});
	TestBed.overrideComponent(Language, {
		set: { imports: [], template: '', providers: [{ provide: DOCUMENT, useValue: doc }] },
	});
	return { widget: TestBed.createComponent(Language).componentInstance, events, doc };
};

describe('Header language', () => {
	it('shows the language in the address, or English', () => {
		expect(render('fr').widget.selectedLanguage.language).toBe('Français');
		expect(render('xx').widget.selectedLanguage.language).toBe('English');
	});

	it('links to this page in each language, following navigation', () => {
		const { widget, events } = render();
		const french = widget.languages[1]!;
		expect(widget.hrefFor(french)).toBe('/fr/collections?page=2');
		events.next(new NavigationStart(1, '/ignored'));
		events.next(new NavigationEnd(2, '/cart', '/cart'));
		expect(widget.hrefFor(french)).toBe('/fr/cart');
	});

	it('leaves no cookie without consent', () => {
		const { widget, doc } = render('fr', 'https:', false);
		widget.selectLanguage(widget.languages[1]!);
		expect(doc.cookie).toBe('');
	});

	it('leaves the choice in a cookie, secure over https only', () => {
		const secure = render();
		secure.widget.active = true;
		secure.widget.selectLanguage(secure.widget.languages[1]!);
		expect(secure.widget.active).toBe(false);
		expect(secure.doc.cookie).toContain('=fr; Path=/; Max-Age=31536000; SameSite=Lax; Secure');
		const plain = render('en', 'http:');
		plain.widget.selectLanguage(plain.widget.languages[0]!);
		expect(plain.doc.cookie).not.toContain('Secure');
		const none = render('en', null);
		none.widget.selectLanguage(none.widget.languages[0]!);
		expect(none.doc.cookie).not.toContain('Secure');
	});

	it('opens and closes', () => {
		const { widget } = render();
		widget.openDropDown();
		expect(widget.active).toBe(true);
		widget.hideDropdown();
		expect(widget.active).toBe(false);
	});
});
