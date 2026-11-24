import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { NEVER, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';

import { AdminAuthGateway } from './auth-gateway';
import { IdleLockService } from './idle-lock.service';

/** The service's tab-message handler, as another tab's message would reach it. */
const fromTab = (service: IdleLockService, data: unknown) =>
	(service as unknown as { onMessage: (event: { data: unknown }) => void }).onMessage({ data });

const setup = (o: { signedIn?: boolean; lockCall?: 'never' } = {}) => {
	const isAuthenticated = signal(o.signedIn ?? true);
	const gateway = {
		refreshSession: vi.fn(() => of<unknown>(undefined)),
		lockSession: vi.fn(() => (o.lockCall === 'never' ? NEVER : of<void>(undefined))),
		markActivity: vi.fn(() => of<void>(undefined)),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{
				provide: AuthStore,
				useValue: { isAuthenticated, sessionLocked: signal(false), status: signal('authenticated') },
			},
			{ provide: AdminAuthGateway, useValue: gateway },
		],
	});
	return { service: TestBed.inject(IdleLockService), gateway, isAuthenticated };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('IdleLockService across tabs', () => {
	it("follows the other tabs' activity, presence, lock and unlock, and ignores anything else", () => {
		const { service } = setup();
		for (const data of [null, 'activity', { type: 'other' }]) fromTab(service, data);
		expect(service.locked()).toBe(false);
		fromTab(service, { type: 'activity', at: Date.now() });
		fromTab(service, { type: 'signal', at: Date.now() });
		fromTab(service, { type: 'locked' });
		expect(service.locked()).toBe(true);
		fromTab(service, { type: 'unlocked' });
		expect(service.locked()).toBe(false);
	});

	it('works without tab messages where the browser has none, and tells others of activity at most every 5 s', () => {
		vi.stubGlobal('BroadcastChannel', undefined);
		const { service, gateway } = setup();
		service.start();
		window.dispatchEvent(new Event('keydown'));
		vi.advanceTimersByTime(1_000);
		window.dispatchEvent(new Event('keydown'));
		vi.advanceTimersByTime(6_000);
		window.dispatchEvent(new Event('keydown'));
		expect(gateway.markActivity).toHaveBeenCalledOnce();
		service.stop();
	});

	it('shows a lock from the server once, and lifts it when signed out meanwhile', () => {
		const { service, isAuthenticated } = setup();
		service.lockFromServer();
		service.lockFromServer();
		expect(service.locked()).toBe(true);
		// Opening the admin behind a lock is not presence.
		service.start();
		isAuthenticated.set(false);
		vi.advanceTimersByTime(15_000);
		expect(service.locked()).toBe(false);
		vi.advanceTimersByTime(15_000);
		expect(service.locked()).toBe(false);
		service.stop();
	});

	it('sends one lock call at a time', () => {
		const { service, gateway } = setup({ lockCall: 'never' });
		service.lock();
		service.lock();
		expect(gateway.lockSession).toHaveBeenCalledOnce();
	});
});
