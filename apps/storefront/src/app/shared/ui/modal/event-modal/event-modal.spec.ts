import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConsentStore } from '@core/consent/consent.store';
import { ShopEvents } from '@core/events/shop-events';

import { EventModal } from './event-modal';

import type { ShopEvent } from '@core/events/shop-event.interface';

vi.mock('@data-access/queries/brand.queries', () => ({
	injectBrandQuery: () => ({ data: () => undefined }),
}));

type Listener = (event: never) => void;

const now = Date.parse('2027-09-21T00:00:00.000Z');
const day = 86_400_000;

const sale = (partial: Partial<ShopEvent> = {}): ShopEvent => ({
	id: 'evt_1',
	type: 'sale',
	title: 'Puja Sale',
	message: '<p>Up to 30% off</p>',
	phase: 'running',
	startsAt: new Date(now - day).toISOString(),
	endsAt: new Date(now + day).toISOString(),
	countdownTo: new Date(now + day).toISOString(),
	popupUntil: new Date(now + day).toISOString(),
	stripUntil: null,
	showCountdown: true,
	linkHref: '/collections/sarees',
	popupImages: [],
	popupImageSide: 'right',
	...partial,
});

const fakeWindow = (search: string, fineHover: boolean) => {
	const store = new Map<string, string>();
	const listeners = new Map<string, Listener>();
	return {
		store,
		listeners,
		innerHeight: 500,
		scrollY: 0,
		location: { search },
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
		functional?: boolean;
		decided?: boolean;
		fineHover?: boolean;
		noWindow?: boolean;
		search?: string;
		items?: ShopEvent[];
		preview?: ShopEvent | null;
		shown?: boolean;
	} = {},
) => {
	const win = fakeWindow(options.search ?? '', options.fineHover ?? true);
	if (options.shown) win.store.set('st_events_shown', '1');
	const docListeners = new Map<string, Listener>();
	const doc = {
		defaultView: options.noWindow ? null : win,
		cookie: options.cookie ?? '',
		documentElement: { scrollHeight: 1500 },
		addEventListener: vi.fn((name: string, listener: Listener) => void docListeners.set(name, listener)),
		removeEventListener: vi.fn((name: string) => void docListeners.delete(name)),
	};
	let close: (value: unknown) => void = () => undefined;
	let dismiss: (reason: unknown) => void = () => undefined;
	const open = vi.fn(() => ({
		result: new Promise((resolve, reject) => {
			close = resolve;
			dismiss = reject;
		}),
	}));
	const events = {
		items: signal(options.items ?? [sale()]),
		popupWaiting: signal(false),
		serverTime: () => now,
		left: vi.fn(() => ({ days: 1, hours: 0, minutes: 0, seconds: 0 })),
		preview: vi.fn((_token: string, done: (event: ShopEvent | null) => void) => done(options.preview ?? null)),
		asked: signal<ShopEvent | null>(null),
	};
	const hasOpenModals = vi.fn(() => false);
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbModal, useValue: { open, hasOpenModals } },
			{ provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
			{ provide: Router, useValue: { url: options.url ?? '/collections/sarees?page=2' } },
			{
				provide: TranslocoService,
				useValue: {
					getActiveLang: () => 'en',
					translate: (key: string, params?: { at: string }) => `${key} ${params?.at}`,
				},
			},
			{
				provide: ConsentStore,
				useValue: { allows: () => options.functional ?? true, decided: () => options.decided ?? true },
			},
			{ provide: ShopEvents, useValue: events },
		],
	});
	TestBed.overrideComponent(EventModal, {
		set: {
			imports: [],
			template: '<ng-template #eventModal></ng-template>',
			providers: [{ provide: DOCUMENT, useValue: doc }],
		},
	});
	const fixture = TestBed.createComponent(EventModal);
	fixture.detectChanges();
	return {
		fixture,
		modal: fixture.componentInstance,
		win,
		doc,
		docListeners,
		open,
		events,
		hasOpenModals,
		close: (value?: unknown) => close(value),
		dismiss: (reason?: unknown) => dismiss(reason),
	};
};

const flush = async () => {
	for (let i = 0; i < 12; i += 1) await Promise.resolve();
};
const scrolledHalf = (parts: ReturnType<typeof render>) => {
	parts.win.scrollY = 600;
	parts.win.listeners.get('scroll')?.(undefined as never);
};

beforeEach(() => vi.useRealTimers());

describe('EventModal arming', () => {
	it('does nothing on the server', () => {
		const { win, events } = render({ platform: 'server' });
		expect(win.addEventListener).not.toHaveBeenCalled();
		expect(events.popupWaiting()).toBe(false);
	});

	it('arms for a published event and makes the newsletter popup wait', () => {
		const { win, doc, events } = render();
		expect(events.popupWaiting()).toBe(true);
		expect(win.listeners.has('scroll')).toBe(true);
		expect(doc.addEventListener).toHaveBeenCalledWith('mouseout', expect.any(Function));
		expect(win.store.get('st_session_start')).toBeDefined();
	});

	it('stays down with no event, once shown this visit, without a window, or for an event already answered', () => {
		expect(render({ items: [] }).win.addEventListener).not.toHaveBeenCalled();
		expect(render({ shown: true }).win.addEventListener).not.toHaveBeenCalled();
		expect(render({ noWindow: true }).doc.addEventListener).not.toHaveBeenCalled();
		const cookie = `x=1; st_events=${encodeURIComponent(`evt_1~${Math.ceil((now + day) / 1000)}`)}`;
		expect(render({ cookie }).win.addEventListener).not.toHaveBeenCalled();
	});

	it('skips the pointer on a touch screen, and stops watching when destroyed', () => {
		expect(render({ fineHover: false }).doc.addEventListener).not.toHaveBeenCalled();
		const { fixture, win, doc } = render();
		fixture.destroy();
		expect(win.clearTimeout).toHaveBeenCalledWith(42);
		expect(win.removeEventListener).toHaveBeenCalled();
		expect(doc.removeEventListener).toHaveBeenCalled();
	});
});

describe('EventModal opening', () => {
	it('opens past half the page, marks the visit, and rests the event for 3 days on ✕', async () => {
		const parts = render();
		parts.win.scrollY = 100;
		parts.win.listeners.get('scroll')?.(undefined as never);
		parts.doc.documentElement.scrollHeight = 100;
		scrolledHalf(parts);
		await flush();
		expect(parts.open).not.toHaveBeenCalled();
		parts.doc.documentElement.scrollHeight = 1500;
		scrolledHalf(parts);
		await flush();
		expect(parts.open).toHaveBeenCalledOnce();
		expect(parts.win.store.get('st_events_shown')).toBe('1');
		expect(parts.win.store.get('st_newsletter_shown')).toBe('1');
		expect(parts.modal.shown()?.id).toBe('evt_1');
		parts.close();
		await flush();
		expect(parts.doc.cookie).toContain(`st_events=${encodeURIComponent(`evt_1~${Math.ceil((now + day) / 1000)}`)}`);
	});

	it('opens on the pointer leaving or the dwell timer, and remembers "don’t show again" until the popup ends', async () => {
		const parts = render();
		const leave = parts.docListeners.get('mouseout')!;
		leave({ relatedTarget: {}, clientY: 0 } as never);
		leave({ relatedTarget: null, clientY: 200 } as never);
		await flush();
		expect(parts.open).not.toHaveBeenCalled();
		leave({ relatedTarget: null, clientY: 0 } as never);
		await flush();
		expect(parts.open).toHaveBeenCalledOnce();
		parts.modal.neverAgain.set(true);
		parts.close();
		await flush();
		expect(parts.doc.cookie).toContain('Max-Age=86400');

		const timed = render();
		((timed.win.setTimeout.mock.calls[0] as unknown[])[0] as () => void)();
		await flush();
		expect(timed.open).toHaveBeenCalledOnce();
	});

	it('remembers a popup dismissed with Escape or a click outside', async () => {
		const parts = render();
		scrolledHalf(parts);
		await flush();
		parts.dismiss('escape');
		await flush();
		expect(parts.doc.cookie).toContain('st_events=');
	});

	it.each(['/cart', '/checkout/pay', '/account/orders', '/auth/login?next=1'])('stays quiet on %s', async (url) => {
		const parts = render({ url });
		scrolledHalf(parts);
		await flush();
		expect(parts.open).not.toHaveBeenCalled();
	});

	it('waits for the cookie answer, and stores nothing without functional consent', async () => {
		const undecided = render({ decided: false });
		scrolledHalf(undecided);
		await flush();
		expect(undecided.open).not.toHaveBeenCalled();
		const refused = render({ functional: false });
		scrolledHalf(refused);
		await flush();
		refused.close();
		await flush();
		expect(refused.doc.cookie).toBe('');
	});
});

describe('EventModal preview', () => {
	it('opens the previewed event at once and remembers nothing', async () => {
		const preview = sale({ id: 'evt_draft' });
		const parts = render({ search: '?event_preview=abc', preview, items: [] });
		expect(parts.events.preview).toHaveBeenCalledWith('abc', expect.any(Function));
		expect(parts.open).toHaveBeenCalledOnce();
		expect(parts.events.popupWaiting()).toBe(true);
		// Published events arriving later don't arm the normal popup on a preview page.
		parts.events.items.set([sale({ id: 'evt_live' })]);
		parts.fixture.detectChanges();
		expect(parts.win.addEventListener).not.toHaveBeenCalled();
		parts.close();
		await flush();
		expect(parts.doc.cookie).toBe('');
		expect(parts.win.store.has('st_events_shown')).toBe(false);
	});

	it('shows nothing for a link that no longer works', () => {
		const parts = render({ search: '?event_preview=old', preview: null });
		expect(parts.events.preview).toHaveBeenCalled();
		expect(parts.open).not.toHaveBeenCalled();
		// The normal popup stands down on a preview page.
		expect(parts.win.removeEventListener).toHaveBeenCalled();
	});
});

describe('EventModal text and picture', () => {
	it('labels the timer, the moment and the button by the event', () => {
		const { modal } = render({ items: [] });
		expect(modal.label(sale())).toBe('event_popup_sale_ends_in');
		expect(modal.left(sale())).toEqual({ days: 1, hours: 0, minutes: 0, seconds: 0 });
		expect(modal.left(sale({ countdownTo: null }))).toBeNull();
		expect(modal.momentText(sale())).toBe('event_ends_at 22 Sep 2027, 5:30 AM IST');
		expect(modal.buttonKey(sale({ phase: 'upcoming' }))).toBe('event_have_a_look');
		expect(modal.buttonKey(sale())).toBe('event_shop_the_sale');
		expect(modal.buttonKey(sale({ type: 'launch', phase: 'launched' }))).toBe('event_shop_the_collection');
	});

	it('uses the largest size of each picture in order, leaving out one with no sizes', async () => {
		const art = (name: string) => ({
			width: 1200,
			height: 1600,
			alt: name,
			roles: {
				banner: [
					{ url: `https://cdn/${name}-s.webp`, width: 600, height: 800 },
					{ url: `https://cdn/${name}-l.webp`, width: 1200, height: 1600 },
				],
			},
		});
		const pictures = [art('one'), { ...art('empty'), roles: {} }, art('two')];
		const parts = render({ items: [sale({ popupImages: pictures as never })] });
		scrolledHalf(parts);
		await flush();
		expect(parts.modal.images()).toEqual([
			{
				src: 'https://cdn/one-l.webp',
				srcset: 'https://cdn/one-s.webp 600w, https://cdn/one-l.webp 1200w',
				width: 1200,
				height: 1600,
				alt: 'one',
			},
			{
				src: 'https://cdn/two-l.webp',
				srcset: 'https://cdn/two-s.webp 600w, https://cdn/two-l.webp 1200w',
				width: 1200,
				height: 1600,
				alt: 'two',
			},
		]);
		expect(parts.open).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ windowClass: 'theme-modal newsletter-modal modal-lg' }),
		);
	});

	it('opens the 400px text-only popup when there is no picture', async () => {
		const parts = render();
		scrolledHalf(parts);
		await flush();
		expect(parts.modal.images()).toEqual([]);
		expect(parts.open).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ windowClass: 'theme-modal newsletter-modal event-popup-text-only' }),
		);
	});

	it('labels the popup timer with its subject, unlike the top bar', () => {
		const { modal } = render({ items: [] });
		expect(modal.label(sale({ phase: 'upcoming' }))).toBe('event_popup_sale_starts_in');
		expect(modal.label(sale({ type: 'launch', phase: 'upcoming' }))).toBe('event_popup_launches_in');
		expect(modal.label(sale({ type: 'launch', phase: 'launched' }))).toBe('event_now_live');
	});
});

describe('EventModal from the phone strip', () => {
	const answered = `x=1; st_events=${encodeURIComponent(`evt_1~${Math.ceil((now + day) / 1000)}`)}`;

	it('opens a tapped event at once, even one already answered, and stores nothing on ✕', async () => {
		const parts = render({ cookie: answered, shown: true, url: '/cart' });
		expect(parts.open).not.toHaveBeenCalled();
		parts.events.asked.set(sale());
		parts.fixture.detectChanges();
		expect(parts.open).toHaveBeenCalledOnce();
		expect(parts.events.asked()).toBeNull();
		parts.close();
		await flush();
		expect(parts.doc.cookie).toBe(answered);
	});

	it('saves a "Don\'t show this again" ticked in a tapped popup', async () => {
		const parts = render({ items: [] });
		parts.events.asked.set(sale());
		parts.fixture.detectChanges();
		parts.modal.neverAgain.set(true);
		parts.close();
		await flush();
		expect(parts.doc.cookie).toContain('st_events=');
	});

	it('does not stack a second popup over an open one', () => {
		const parts = render({ items: [] });
		parts.hasOpenModals.mockReturnValue(true);
		parts.events.asked.set(sale());
		parts.fixture.detectChanges();
		expect(parts.open).not.toHaveBeenCalled();
		expect(parts.events.asked()).toBeNull();
	});
});
