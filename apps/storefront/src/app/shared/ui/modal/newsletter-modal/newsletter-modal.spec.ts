import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewsletterModal } from './newsletter-modal';

vi.mock('@core/config/runtime-config', () => ({
	runtimeConfig: { apiUrl: 'https://api.test' },
	runtimeConfigReady: Promise.resolve(),
}));

type Listener = (event: never) => void;

const fakeWindow = (fineHover = true) => {
	const store = new Map<string, string>();
	const listeners = new Map<string, Listener>();
	return {
		store,
		listeners,
		innerHeight: 500,
		scrollY: 0,
		sessionStorage: {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => void store.set(key, value),
		},
		setTimeout: vi.fn(() => 42),
		clearTimeout: vi.fn(),
		addEventListener: vi.fn((name: string, listener: Listener) => void listeners.set(name, listener)),
		removeEventListener: vi.fn((name: string) => void listeners.delete(name)),
		matchMedia: () => ({ matches: fineHover }),
	};
};

const render = (
	options: {
		platform?: string;
		url?: string;
		cookie?: string;
		fineHover?: boolean;
		noWindow?: boolean;
		banners?: unknown;
		result?: Promise<unknown>;
	} = {},
) => {
	const win = fakeWindow(options.fineHover);
	const docListeners = new Map<string, Listener>();
	const doc = {
		defaultView: options.noWindow ? null : win,
		cookie: options.cookie ?? '',
		documentElement: { scrollHeight: 1500 },
		addEventListener: vi.fn((name: string, listener: Listener) => void docListeners.set(name, listener)),
		removeEventListener: vi.fn((name: string) => void docListeners.delete(name)),
	};
	const open = vi.fn(() => ({ result: options.result ?? Promise.resolve('closed') }));
	const get = vi.fn(() => options.banners ?? of({ banners: [] }));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbModal, useValue: { open } },
			{ provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
			{ provide: Router, useValue: { url: options.url ?? '/collections/sarees?page=2' } },
			{ provide: HttpClient, useValue: { get } },
			{ provide: TranslocoService, useValue: { getActiveLang: () => 'en' } },
		],
	});
	TestBed.overrideComponent(NewsletterModal, {
		set: {
			imports: [],
			template: '<ng-template #newsletterModal></ng-template>',
			providers: [{ provide: DOCUMENT, useValue: doc }],
		},
	});
	const fixture = TestBed.createComponent(NewsletterModal);
	fixture.detectChanges();
	return { fixture, modal: fixture.componentInstance, win, doc, docListeners, open, get };
};
const flush = async () => {
	for (let i = 0; i < 12; i += 1) await Promise.resolve();
};
const scrolledHalf = (parts: ReturnType<typeof render>) => {
	parts.win.scrollY = 600;
	parts.win.listeners.get('scroll')?.(undefined as never);
};

beforeEach(() => vi.useRealTimers());

describe('NewsletterModal arming', () => {
	it('does nothing on the server', () => {
		const { win } = render({ platform: 'server' });
		expect(win.addEventListener).not.toHaveBeenCalled();
	});

	it('does nothing once answered or shown this session', () => {
		expect(render({ cookie: 'x=1; st_newsletter=never' }).win.addEventListener).not.toHaveBeenCalled();
	});

	it('does nothing without a window', () => {
		const { doc } = render({ noWindow: true });
		expect(doc.addEventListener).not.toHaveBeenCalled();
	});

	it('watches scrolling, the dwell timer and the pointer on a desktop', () => {
		const { win, doc } = render();
		expect(win.listeners.has('scroll')).toBe(true);
		expect(win.setTimeout).toHaveBeenCalledOnce();
		expect(doc.addEventListener).toHaveBeenCalledWith('mouseout', expect.any(Function));
		expect(win.store.get('st_session_start')).toBeDefined();
	});

	it('skips the pointer on a touch screen', () => {
		expect(render({ fineHover: false }).doc.addEventListener).not.toHaveBeenCalled();
	});

	it('stops watching when destroyed', () => {
		const { fixture, win, doc } = render();
		fixture.destroy();
		expect(win.clearTimeout).toHaveBeenCalledWith(42);
		expect(win.removeEventListener).toHaveBeenCalled();
		expect(doc.removeEventListener).toHaveBeenCalled();
	});

	it('survives being destroyed after it already fired', async () => {
		const parts = render();
		scrolledHalf(parts);
		await flush();
		parts.fixture.destroy();
		expect(parts.win.clearTimeout).toHaveBeenCalledOnce();
	});
});

describe('NewsletterModal triggers', () => {
	it('opens past half the page, and stays shut before it', async () => {
		const parts = render();
		parts.win.scrollY = 100;
		parts.win.listeners.get('scroll')?.(undefined as never);
		await flush();
		expect(parts.open).not.toHaveBeenCalled();
		scrolledHalf(parts);
		await flush();
		expect(parts.open).toHaveBeenCalledOnce();
		expect(parts.win.store.get('st_newsletter_shown')).toBe('1');
	});

	it('does not divide by a page that cannot scroll', async () => {
		const parts = render();
		parts.doc.documentElement.scrollHeight = 100;
		scrolledHalf(parts);
		await flush();
		expect(parts.open).not.toHaveBeenCalled();
	});

	it('opens when the pointer leaves for the browser chrome only', async () => {
		const parts = render();
		const leave = parts.docListeners.get('mouseout')!;
		leave({ relatedTarget: {}, clientY: 0 } as never);
		leave({ relatedTarget: null, clientY: 200 } as never);
		await flush();
		expect(parts.open).not.toHaveBeenCalled();
		leave({ relatedTarget: null, clientY: 0 } as never);
		await flush();
		expect(parts.open).toHaveBeenCalledOnce();
	});

	it('opens when the dwell timer fires', async () => {
		const parts = render();
		const fire = (parts.win.setTimeout.mock.calls[0] as unknown[])[0] as () => void;
		fire();
		await flush();
		expect(parts.open).toHaveBeenCalledOnce();
	});

	it.each(['/cart', '/checkout/pay', '/account/orders', '/auth/login?next=1'])('stays quiet on %s', async (url) => {
		const parts = render({ url });
		scrolledHalf(parts);
		await flush();
		expect(parts.open).not.toHaveBeenCalled();
	});

	it('does not mistake a similar path for a quiet one', async () => {
		const parts = render({ url: '/cartoons' });
		scrolledHalf(parts);
		await flush();
		expect(parts.open).toHaveBeenCalledOnce();
	});

	it('will not open twice in a session', async () => {
		const parts = render();
		scrolledHalf(parts);
		await flush();
		parts.win.store.set('st_newsletter_shown', '1');
		const fire = (parts.win.setTimeout.mock.calls[0] as unknown[])[0] as () => void;
		fire();
		await flush();
		expect(parts.open).toHaveBeenCalledOnce();
	});
});

describe('NewsletterModal image', () => {
	const banner = {
		position: 'newsletter_popup',
		alt: 'Festive',
		images: {
			desktop: {
				width: 800,
				height: 600,
				roles: {
					banner: [
						{ url: 'https://cdn/s.webp', width: 400, height: 300 },
						{ url: 'https://cdn/l.webp', width: 800, height: 600 },
					],
				},
			},
		},
	};

	it('uses the live banner', async () => {
		const parts = render({ banners: of({ banners: [{ position: 'other' }, banner] }) });
		scrolledHalf(parts);
		await flush();
		expect(parts.modal.image()).toEqual({
			src: 'https://cdn/l.webp',
			srcset: 'https://cdn/s.webp 400w, https://cdn/l.webp 800w',
			width: 800,
			height: 600,
			alt: 'Festive',
		});
	});

	it('keeps the theme artwork without a banner, with an empty one, or on failure', async () => {
		const emptyRoles = { ...banner, images: { desktop: { width: 1, height: 1, roles: {} } } };
		for (const banners of [
			of({ banners: [] }),
			of({ banners: [emptyRoles] }),
			throwError(() => new Error('down')),
		]) {
			const parts = render({ banners });
			scrolledHalf(parts);
			await flush();
			expect(parts.modal.image().src).toBe('assets/images/newsletter/3.jpg');
			expect(parts.open).toHaveBeenCalledOnce();
		}
	});
});

describe('NewsletterModal answers', () => {
	it('rests for a week after closing', async () => {
		const parts = render();
		scrolledHalf(parts);
		await flush();
		expect(parts.doc.cookie).toContain('st_newsletter=snoozed; Max-Age=604800');
	});

	it('rests for a year after "do not show again", also when dismissed', async () => {
		const parts = render({ result: new Promise((_, reject) => setTimeout(() => reject(new Error('x')), 0)) });
		scrolledHalf(parts);
		await flush();
		parts.modal.neverAgain.set(true);
		await new Promise((settle) => setTimeout(settle, 1));
		await flush();
		expect(parts.doc.cookie).toContain('st_newsletter=never; Max-Age=31536000');
	});

	it('never downgrades a subscriber', async () => {
		const parts = render();
		parts.modal.markSubscribed();
		expect(parts.doc.cookie).toContain('st_newsletter=subscribed');
		parts.doc.cookie = 'st_newsletter=subscribed';
		parts.modal.markSubscribed();
		expect(parts.doc.cookie).toBe('st_newsletter=subscribed');
	});

	it('says plainly that signup is not available yet, and ignores blanks', () => {
		const { modal } = render();
		modal.submit('   ');
		expect(modal.notice()).toBeNull();
		modal.submit('a@b.co');
		expect(modal.notice()).toBe('newsletter_signup_coming_soon');
	});
});
