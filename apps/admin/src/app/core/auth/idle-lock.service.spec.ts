import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';

import { AdminAuthGateway } from './auth-gateway';
import { ADMIN_SOFT_LOCK_MS, IdleLockService } from './idle-lock.service';

const setup = (signedIn = true) => {
	const isAuthenticated = signal(signedIn);
	const gateway = { refreshSession: vi.fn(() => of<unknown>(undefined)) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: AuthStore, useValue: { isAuthenticated } },
			{ provide: AdminAuthGateway, useValue: gateway },
		],
	});
	return { service: TestBed.inject(IdleLockService), gateway, isAuthenticated };
};
const visible = (value: string) => {
	Object.defineProperty(document, 'visibilityState', { configurable: true, value });
	document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

describe('IdleLockService', () => {
	it('locks after the idle period', () => {
		const { service } = setup();
		service.start();
		vi.advanceTimersByTime(ADMIN_SOFT_LOCK_MS + 15_000);
		expect(service.locked()).toBe(true);
		service.stop();
	});

	it('stays open while there is activity', () => {
		const { service } = setup();
		service.start();
		vi.advanceTimersByTime(ADMIN_SOFT_LOCK_MS - 1000);
		window.dispatchEvent(new Event('keydown'));
		vi.advanceTimersByTime(30_000);
		expect(service.locked()).toBe(false);
		service.stop();
	});

	it('ignores activity behind the lock, until unlocked', () => {
		const { service } = setup();
		service.start();
		service.lock();
		window.dispatchEvent(new Event('mousemove'));
		vi.advanceTimersByTime(15_000);
		expect(service.locked()).toBe(true);
		service.unlock();
		expect(service.locked()).toBe(false);
		service.stop();
	});

	it('starts once, and stops cleanly when never started', () => {
		const { service } = setup();
		service.stop();
		service.start();
		service.start();
		expect(vi.getTimerCount()).toBe(1);
		service.stop();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('clears the lock when the session is gone', () => {
		const { service, isAuthenticated } = setup();
		service.start();
		service.lock();
		isAuthenticated.set(false);
		vi.advanceTimersByTime(15_000);
		expect(service.locked()).toBe(false);
		service.stop();
	});

	it('will not lock without a session', () => {
		const { service } = setup(false);
		service.lock();
		expect(service.locked()).toBe(false);
	});

	it('refreshes the cookies when the tab returns, at most once a minute', async () => {
		const { service, gateway } = setup();
		service.start();
		vi.setSystemTime(Date.now() + 120_000);
		visible('visible');
		await vi.advanceTimersByTimeAsync(0);
		visible('visible');
		await vi.advanceTimersByTimeAsync(0);
		expect(gateway.refreshSession).toHaveBeenCalledOnce();
		service.stop();
	});

	it('stays quiet for a hidden tab, a locked screen or no session', async () => {
		const { service, gateway, isAuthenticated } = setup();
		service.start();
		visible('hidden');
		isAuthenticated.set(false);
		visible('visible');
		isAuthenticated.set(true);
		service.locked.set(true);
		visible('visible');
		await vi.advanceTimersByTimeAsync(0);
		expect(gateway.refreshSession).not.toHaveBeenCalled();
		service.stop();
	});

	it('survives a failed refresh', async () => {
		const { service, gateway } = setup();
		gateway.refreshSession.mockReturnValue(throwError(() => new Error('down')));
		vi.setSystemTime(Date.now() + 120_000);
		service.lock();
		await vi.advanceTimersByTimeAsync(0);
		expect(service.locked()).toBe(true);
	});
});
