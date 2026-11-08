import { describe, expect, it } from 'vitest';

import {
	REST_MS,
	answerUntil,
	choosePopupEvent,
	countdownKey,
	momentKey,
	readEventsCookie,
	writeEventsCookie,
} from './event-popup-rules';

import type { ShopEvent } from './shop-event.interface';

const now = Date.parse('2027-09-21T00:00:00.000Z');
const day = 86_400_000;

const event = (id: string, partial: Partial<ShopEvent>): ShopEvent => ({
	id,
	type: 'sale',
	title: id,
	message: '',
	phase: 'running',
	startsAt: new Date(now - day).toISOString(),
	endsAt: new Date(now + 5 * day).toISOString(),
	countdownTo: null,
	popupUntil: new Date(now + 5 * day).toISOString(),
	stripUntil: null,
	showCountdown: true,
	linkHref: '/',
	popupImage: null,
	...partial,
});

describe('choosePopupEvent', () => {
	const soon = event('soon', { endsAt: new Date(now + day).toISOString() });
	const later = event('later', {});
	const upcoming = event('upcoming', { phase: 'upcoming', startsAt: new Date(now + day).toISOString() });
	const launch = event('launch', { type: 'launch', phase: 'launched', endsAt: null });

	it('shows the running sale that ends soonest, then a sale about to start, then a launch', () => {
		expect(choosePopupEvent([launch, upcoming, later, soon], now, new Map())?.id).toBe('soon');
		expect(choosePopupEvent([launch, upcoming], now, new Map())?.id).toBe('upcoming');
		expect(choosePopupEvent([launch], now, new Map())?.id).toBe('launch');
	});

	it('skips one the visitor answered and one whose popup is over', () => {
		const answered = new Map([['soon', now + day]]);
		expect(choosePopupEvent([soon, later], now, answered)?.id).toBe('later');
		const over = event('over', { popupUntil: new Date(now - 1).toISOString() });
		expect(choosePopupEvent([over], now, new Map())).toBeNull();
	});
});

describe('the st_events cookie', () => {
	it('rests an event for 3 days on ✕, and until its popup ends on the tick', () => {
		const sale = event('a', {});
		expect(answerUntil(sale, false, now)).toBe(now + REST_MS);
		expect(answerUntil(sale, true, now)).toBe(now + 5 * day);
		const short = event('b', { popupUntil: new Date(now + day).toISOString() });
		expect(answerUntil(short, false, now)).toBe(now + day);
	});

	it('round-trips, drops ended entries, and ends with its last entry', () => {
		const written = writeEventsCookie(
			new Map([
				['evt_a', now + day],
				['evt_old', now - 1],
			]),
			now,
		);
		expect(written.maxAge).toBe(86_400);
		expect([...readEventsCookie(written.value).keys()]).toEqual(['evt_a']);
		expect(readEventsCookie('bad~x.<script>~5')).toEqual(new Map());
	});
});

describe('labels', () => {
	it('names the countdown and the fixed moment for each phase', () => {
		expect(countdownKey(event('a', { phase: 'upcoming' }))).toBe('event_sale_starts_in');
		expect(countdownKey(event('a', {}))).toBe('event_sale_ends_in');
		expect(countdownKey(event('a', { type: 'launch', phase: 'upcoming' }))).toBe('event_launches_in');
		expect(momentKey(event('a', { type: 'launch', phase: 'launched' })).key).toBe('event_live_since');
		expect(momentKey(event('a', {})).key).toBe('event_ends_at');
	});
});
