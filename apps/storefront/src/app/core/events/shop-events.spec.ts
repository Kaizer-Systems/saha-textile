import { HttpClient } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Subject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShopEvents } from './shop-events';

import type { ShopEvent, ShopEventsResponse } from './shop-event.interface';

const at = Date.parse('2027-09-21T00:00:00.000Z');

const event = (partial: Partial<ShopEvent> = {}): ShopEvent => ({
	id: 'evt_1',
	type: 'sale',
	title: 'Puja Sale',
	message: '',
	phase: 'running',
	startsAt: new Date(at - 86_400_000).toISOString(),
	endsAt: new Date(at + 86_400_000).toISOString(),
	countdownTo: new Date(at + 86_400_000).toISOString(),
	popupUntil: new Date(at + 86_400_000).toISOString(),
	stripUntil: new Date(at + 86_400_000).toISOString(),
	showCountdown: true,
	linkHref: '/',
	popupImage: null,
	...partial,
});

const setup = (platform: string, get: (...args: unknown[]) => unknown) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: HttpClient, useValue: { get: vi.fn(get) } },
			{ provide: PLATFORM_ID, useValue: platform },
		],
	});
	return TestBed.inject(ShopEvents);
};

afterEach(() => vi.useRealTimers());

describe('ShopEvents', () => {
	it('reads events once on the server, with the server clock', () => {
		vi.useFakeTimers({ now: at - 5_000 });
		const response: ShopEventsResponse = { serverNow: new Date(at).toISOString(), items: [event()] };
		const events = setup('server', () => of(response));
		events.load();
		events.load();
		expect(events.items()).toHaveLength(1);
		expect(events.serverTime()).toBe(at);
		expect(events.stripItems()).toHaveLength(1);
		expect(events.left(null)).toBeNull();
		expect(events.left(new Date(at + 61_000).toISOString())).toEqual({ days: 0, hours: 0, minutes: 1, seconds: 1 });
	});

	it('reads again in the browser, ticks every second, and keeps quiet when a read fails', () => {
		vi.useFakeTimers({ now: at });
		const strip = new Date(at + 2_000).toISOString();
		const response: ShopEventsResponse = {
			serverNow: new Date(at).toISOString(),
			items: [event({ stripUntil: strip }), event({ id: 'b', stripUntil: null })],
		};
		const events = setup('browser', () => of(response));
		events.load();
		expect(events.stripItems().map((row) => row.id)).toEqual(['evt_1']);
		vi.advanceTimersByTime(3_000);
		expect(events.stripItems()).toEqual([]);
		events.stop();
		events.stop();
		const failing = setup('browser', () => throwError(() => new Error('down')));
		failing.load();
		expect(failing.items()).toEqual([]);
		failing.stop();
	});

	it('previews one event through its link, and hands back nothing when the link fails or is empty', () => {
		vi.useFakeTimers({ now: at });
		const reply = new Subject<ShopEventsResponse>();
		const events = setup('browser', () => reply);
		const done = vi.fn();
		events.preview('token', done);
		reply.next({ serverNow: new Date(at + 10_000).toISOString(), items: [event()] });
		expect(done).toHaveBeenCalledWith(expect.objectContaining({ id: 'evt_1' }));
		expect(events.serverTime()).toBe(at + 10_000);
		const empty = setup('browser', () => of({ serverNow: new Date(at).toISOString(), items: [] }));
		empty.preview('token', done);
		expect(done).toHaveBeenLastCalledWith(null);
		const failing = setup('browser', () => throwError(() => new Error('down')));
		failing.preview('token', done);
		expect(done).toHaveBeenLastCalledWith(null);
	});
});
