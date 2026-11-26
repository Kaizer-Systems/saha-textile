import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideTransloco } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { ConsentStore } from '@core/consent/consent.store';
import { CONSENT_ASK_CLASS, CONSENT_TAP_ATTRIBUTE } from '@core/consent/cookie-catalogue';
import { AuthStore } from '@core/state/auth.store';

import { Cookie } from './cookie';
import { CookieSettings, longestLabel } from './cookie-settings/cookie-settings';

const consentDouble = (functional = false) => ({
	settingsRequests: signal(0),
	decided: signal(false),
	openSettings: vi.fn(),
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
		// Like ng-bootstrap's popup: its result settles when it is closed, and fails when it is dismissed.
		let settle = { closed: () => {}, dismissed: () => {} };
		const close = vi.fn(() => settle.closed());
		const open = vi.fn(() => ({
			close,
			result: new Promise<void>((closed, dismissed) => {
				settle = { closed: () => closed(), dismissed: () => dismissed() };
			}),
		}));
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
		return { page: fixture.componentInstance, consent, open, close, dismiss: () => settle.dismissed() };
	};
	const settled = () => new Promise((done) => setTimeout(done));

	it('opens one popup however often it is asked, and again once it is closed or dismissed', async () => {
		const { page, consent, open, dismiss } = setup();
		consent.settingsRequests.set(1);
		TestBed.tick();
		consent.settingsRequests.set(2);
		TestBed.tick();
		expect(open).toHaveBeenCalledOnce();

		page.saveChoices();
		await settled();
		consent.settingsRequests.set(3);
		TestBed.tick();
		expect(open).toHaveBeenCalledTimes(2);

		dismiss();
		await settled();
		consent.settingsRequests.set(4);
		TestBed.tick();
		expect(open).toHaveBeenCalledTimes(3);
	});

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
		const open = vi.fn(() => ({ close: vi.fn(), result: new Promise<void>(() => {}) }));
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: ConsentStore, useValue: consent },
				{ provide: AuthStore, useValue: { isAuthenticated } },
				{ provide: NgbModal, useValue: { open } },
			],
		});
		TestBed.overrideComponent(Cookie, { set: { imports: [CookieSettings], template: '<app-cookie-settings />' } });
		TestBed.overrideComponent(CookieSettings, {
			set: { imports: [], template: '<ng-template #cookieSettings></ng-template>' },
		});
		const fixture = TestBed.createComponent(Cookie);
		fixture.detectChanges();
		return { box: fixture.componentInstance, consent, isAuthenticated, open };
	};

	it('answers an early tap once when it arrives twice: carried out from the note, then replayed late', () => {
		const { box, consent } = setup();
		consent.save.mockImplementation(() => consent.decided.set(true));
		document.documentElement.setAttribute(CONSENT_TAP_ATTRIBUTE, 'cookie_accept_btn');
		box.carryOutEarlyTap(document);
		box.acceptAll();
		box.necessaryOnly();
		box.choose();
		expect(consent.save).toHaveBeenCalledOnce();
		expect(consent.openSettings).not.toHaveBeenCalled();
	});

	it('opens one settings popup for a Choose tap that arrives twice', () => {
		const { box, consent, open } = setup();
		consent.openSettings.mockImplementation(() => consent.settingsRequests.update((count) => count + 1));
		document.documentElement.setAttribute(CONSENT_TAP_ATTRIBUTE, 'cookie_choose_btn');
		box.carryOutEarlyTap(document);
		TestBed.tick();
		box.choose();
		TestBed.tick();
		expect(consent.openSettings).toHaveBeenCalledTimes(2);
		expect(open).toHaveBeenCalledOnce();
	});

	it('carries out a tap noted before it woke, once, when no replay did (D1, 21 Nov)', () => {
		const { box, consent } = setup();
		document.documentElement.setAttribute(CONSENT_TAP_ATTRIBUTE, 'cookie_accept_btn');
		box.carryOutEarlyTap(document);
		expect(consent.save).toHaveBeenCalledOnce();
		expect(consent.save).toHaveBeenLastCalledWith({ functional: true });
		expect(document.documentElement.hasAttribute(CONSENT_TAP_ATTRIBUTE)).toBe(false);
		box.carryOutEarlyTap(document);
		expect(consent.save).toHaveBeenCalledOnce();
	});

	it('leaves a noted tap alone when Angular replayed it, or a decision exists', () => {
		const replayed = setup();
		replayed.box.necessaryOnly();
		document.documentElement.setAttribute(CONSENT_TAP_ATTRIBUTE, 'cookie_necessary_btn');
		replayed.box.carryOutEarlyTap(document);
		expect(replayed.consent.save).toHaveBeenCalledOnce();

		const decided = setup();
		decided.consent.decided.set(true);
		document.documentElement.setAttribute(CONSENT_TAP_ATTRIBUTE, 'cookie_accept_btn');
		decided.box.carryOutEarlyTap(document);
		expect(decided.consent.save).not.toHaveBeenCalled();
	});

	it('carries out a noted tap by itself once it has drawn, after the turn Angular gives its replay', async () => {
		document.documentElement.setAttribute(CONSENT_TAP_ATTRIBUTE, 'cookie_necessary_btn');
		const { consent } = setup();
		TestBed.tick();
		expect(consent.save).not.toHaveBeenCalled();
		await new Promise((done) => setTimeout(done));
		expect(consent.save).toHaveBeenCalledExactlyOnceWith({ functional: false });
		expect(document.documentElement.hasAttribute(CONSENT_TAP_ATTRIBUTE)).toBe(false);
	});

	it('ignores a noted tap on a button it does not have, as an older cached page head could note', () => {
		const { box, consent } = setup();
		document.documentElement.setAttribute(CONSENT_TAP_ATTRIBUTE, 'cookie_old_btn');
		box.carryOutEarlyTap(document);
		expect(consent.save).not.toHaveBeenCalled();
		expect(consent.openSettings).not.toHaveBeenCalled();
		expect(document.documentElement.hasAttribute(CONSENT_TAP_ATTRIBUTE)).toBe(false);
	});

	it('opens the settings for a noted Choose tap', () => {
		const { box, consent } = setup();
		document.documentElement.setAttribute(CONSENT_TAP_ATTRIBUTE, 'cookie_choose_btn');
		box.carryOutEarlyTap(document);
		expect(consent.openSettings).toHaveBeenCalledOnce();
		expect(consent.save).not.toHaveBeenCalled();
	});

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
				{
					provide: ConsentStore,
					useValue: { ...consentDouble(), boxOpen: signal(open), openSettings: vi.fn() },
				},
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
