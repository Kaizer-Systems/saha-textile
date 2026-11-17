import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideTransloco } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { ConsentStore } from '@core/consent/consent.store';
import { CONSENT_ASK_CLASS } from '@core/consent/cookie-catalogue';
import { AuthStore } from '@core/state/auth.store';

import { Cookie } from './cookie';
import { CookieSettings, longestLabel } from './cookie-settings/cookie-settings';

const consentDouble = (functional = false) => ({
	settingsRequests: signal(0),
	allows: vi.fn(() => functional),
	save: vi.fn(),
	syncAccount: vi.fn(async () => {}),
});

describe('longestLabel', () => {
	it('gives the length of the longest label', () => {
		expect(longestLabel('Accept all', 'Necessary only', 'OK')).toBe(14);
	});
});

describe('CookieSettings', () => {
	const setup = (functional = false) => {
		const consent = consentDouble(functional);
		const close = vi.fn();
		const open = vi.fn(() => ({ close }));
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: ConsentStore, useValue: consent },
				{ provide: NgbModal, useValue: { open } },
			],
		});
		TestBed.overrideComponent(CookieSettings, {
			set: { imports: [], template: '<ng-template #cookieSettings></ng-template>' },
		});
		const fixture = TestBed.createComponent(CookieSettings);
		fixture.detectChanges();
		return { page: fixture.componentInstance, consent, open, close };
	};

	it('stays closed until asked, then shows the current choice', () => {
		const { page, consent, open } = setup(true);
		TestBed.tick();
		expect(open).not.toHaveBeenCalled();
		consent.settingsRequests.set(1);
		TestBed.tick();
		expect(open).toHaveBeenCalledOnce();
		expect(page.functional()).toBe(true);
	});

	it('opens one list at a time', () => {
		const { page } = setup();
		page.toggleList('necessary');
		expect(page.openList()).toBe('necessary');
		page.toggleList('functional');
		expect(page.openList()).toBe('functional');
		page.toggleList('functional');
		expect(page.openList()).toBeNull();
	});

	it('saves each answer', () => {
		const { page, consent, close } = setup();
		consent.settingsRequests.set(1);
		TestBed.tick();
		page.acceptAll();
		expect(consent.save).toHaveBeenLastCalledWith({ functional: true });
		expect(close).toHaveBeenCalled();
		page.necessaryOnly();
		expect(consent.save).toHaveBeenLastCalledWith({ functional: false });
		page.functional.set(true);
		page.saveChoices();
		expect(consent.save).toHaveBeenLastCalledWith({ functional: true });
	});

	it('saves from the box with the popup never opened', () => {
		const { page, consent } = setup();
		page.acceptAll();
		expect(consent.save).toHaveBeenCalledOnce();
	});
});

describe('Cookie', () => {
	const setup = () => {
		const consent = consentDouble();
		const isAuthenticated = signal(false);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: ConsentStore, useValue: consent },
				{ provide: AuthStore, useValue: { isAuthenticated } },
				{ provide: NgbModal, useValue: { open: vi.fn() } },
			],
		});
		TestBed.overrideComponent(Cookie, { set: { imports: [CookieSettings], template: '<app-cookie-settings />' } });
		TestBed.overrideComponent(CookieSettings, {
			set: { imports: [], template: '<ng-template #cookieSettings></ng-template>' },
		});
		const fixture = TestBed.createComponent(Cookie);
		fixture.detectChanges();
		return { box: fixture.componentInstance, consent, isAuthenticated };
	};

	it('answers from the box', () => {
		const { box, consent } = setup();
		box.acceptAll();
		expect(consent.save).toHaveBeenLastCalledWith({ functional: true });
		box.necessaryOnly();
		expect(consent.save).toHaveBeenLastCalledWith({ functional: false });
	});

	it('joins the account once per sign-in', () => {
		const { consent, isAuthenticated } = setup();
		TestBed.tick();
		expect(consent.syncAccount).not.toHaveBeenCalled();
		isAuthenticated.set(true);
		TestBed.tick();
		expect(consent.syncAccount).toHaveBeenCalledOnce();
		isAuthenticated.set(false);
		TestBed.tick();
		isAuthenticated.set(true);
		TestBed.tick();
		expect(consent.syncAccount).toHaveBeenCalledTimes(2);
	});

	it("takes over from the page head's mark once it has drawn, so the box follows the decision alone (D1)", () => {
		document.documentElement.classList.add(CONSENT_ASK_CLASS);
		setup();
		TestBed.tick();
		expect(document.documentElement.classList.contains(CONSENT_ASK_CLASS)).toBe(false);
	});
});

describe('Cookie box markup (D1)', () => {
	const render = (open: boolean) => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: ConsentStore, useValue: { ...consentDouble(), boxOpen: signal(open), openSettings: vi.fn() } },
				{ provide: AuthStore, useValue: { isAuthenticated: signal(false) } },
				{ provide: NgbModal, useValue: { open: vi.fn() } },
				provideRouter([]),
				provideTransloco({ config: { availableLangs: ['en'], defaultLang: 'en' }, loader: undefined }),
			],
		});
		TestBed.overrideComponent(CookieSettings, {
			set: { imports: [], template: '<ng-template #cookieSettings></ng-template>' },
		});
		const fixture = TestBed.createComponent(Cookie);
		fixture.detectChanges();
		return fixture.nativeElement as HTMLElement;
	};

	it('is always drawn, hidden until the visitor has to decide', () => {
		const closed = render(false).querySelector<HTMLElement>('.cookie-bar-box');
		expect(closed?.hidden).toBe(true);
		const open = render(true).querySelector<HTMLElement>('.cookie-bar-box');
		expect(open?.hidden).toBe(false);
		expect(open?.querySelector('p.h5.text-content')).not.toBeNull();
		expect(open?.querySelector('img')?.getAttribute('loading')).toBe('lazy');
	});
});
