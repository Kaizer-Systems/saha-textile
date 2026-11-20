import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';

import { AdminAuthGateway } from './auth-gateway';
import { ACTIVITY_SIGNAL_GAP_MS, ADMIN_SOFT_LOCK_MS, IdleLockService } from './idle-lock.service';

const setup = (o: { signedIn?: boolean; serverLocked?: boolean; status?: string } = {}) => {
	const isAuthenticated = signal(o.signedIn ?? true);
	const sessionLocked = signal(o.serverLocked ?? false);
	const status = signal(o.status ?? 'authenticated');
	const gateway = {
		refreshSession: vi.fn(() => of<unknown>(undefined)),
		lockSession: vi.fn(() => of<void>(undefined)),
		markActivity: vi.fn(() => of<void>(undefined)),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: AuthStore, useValue: { isAuthenticated, sessionLocked, status } },
			{ provide: AdminAuthGateway, useValue: gateway },
		],
	});
	return { service: TestBed.inject(IdleLockService), gateway, isAuthenticated, status };
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
	it('locks after the idle period, and tells the server', () => {
		const { service, gateway } = setup();
		service.start();
		vi.advanceTimersByTime(ADMIN_SOFT_LOCK_MS + 15_000);
		expect(service.locked()).toBe(true);
		expect(gateway.lockSession).toHaveBeenCalledOnce();
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

	it('tells the server the operator is present when the admin opens, then at most once a minute', () => {
		const { service, gateway } = setup();
		service.start();
		expect(gateway.markActivity).toHaveBeenCalledOnce();
		window.dispatchEvent(new Event('mousemove'));
		vi.advanceTimersByTime(10_000);
		window.dispatchEvent(new Event('keydown'));
		expect(gateway.markActivity).toHaveBeenCalledOnce();
		vi.advanceTimersByTime(ACTIVITY_SIGNAL_GAP_MS);
		window.dispatchEvent(new Event('scroll'));
		expect(gateway.markActivity).toHaveBeenCalledTimes(2);
		service.stop();
	});

	it('sends no presence signal without activity, so an unattended tab locks on the server too', () => {
		const { service, gateway } = setup();
		service.start();
		vi.advanceTimersByTime(ADMIN_SOFT_LOCK_MS - 1000);
		expect(gateway.markActivity).toHaveBeenCalledOnce();
		service.stop();
	});

	it('comes back locked after a reload when the server says so, without asking it again', () => {
		const { service, gateway } = setup({ serverLocked: true });
		service.start();
		expect(service.locked()).toBe(true);
		expect(gateway.lockSession).not.toHaveBeenCalled();
		expect(gateway.markActivity).not.toHaveBeenCalled();
		service.stop();
	});

	it('keeps asking the server until it accepts the lock, so a reload cannot skip it', async () => {
		const { service, gateway } = setup();
		gateway.lockSession.mockReturnValueOnce(throwError(() => new Error('offline')));
		service.start();
		service.lock();
		await vi.advanceTimersByTimeAsync(0);
		expect(gateway.lockSession).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(15_000);
		expect(gateway.lockSession).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(15_000);
		expect(gateway.lockSession).toHaveBeenCalledTimes(2);
		service.stop();
	});

	it('shows the lock when the server refuses a call, and lets waiting calls go after the PIN', async () => {
		const { service } = setup();
		service.start();
		service.lockFromServer();
		expect(service.locked()).toBe(true);
		let released = false;
		const waiting = service.whenUnlocked().then(() => (released = true));
		await Promise.resolve();
		expect(released).toBe(false);
		service.unlock();
		await waiting;
		expect(released).toBe(true);
		expect(service.locked()).toBe(false);
		await expect(service.whenUnlocked()).resolves.toBeUndefined();
		service.stop();
	});

	it('ignores activity behind the lock, until unlocked', () => {
		const { service, gateway } = setup();
		service.start();
		service.lock();
		gateway.markActivity.mockClear();
		window.dispatchEvent(new Event('mousemove'));
		vi.advanceTimersByTime(15_000);
		expect(service.locked()).toBe(true);
		expect(gateway.markActivity).not.toHaveBeenCalled();
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
		const { service } = setup({ signedIn: false });
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

	it('survives a failed refresh and a failed lock call', async () => {
		const { service, gateway } = setup();
		gateway.refreshSession.mockReturnValue(throwError(() => new Error('down')));
		gateway.lockSession.mockReturnValue(throwError(() => new Error('down')));
		vi.setSystemTime(Date.now() + 120_000);
		service.lock();
		await vi.advanceTimersByTimeAsync(0);
		expect(service.locked()).toBe(true);
	});
});

describe('IdleLockService across tabs', () => {
	it('locks and unlocks every tab together, and shares activity', async () => {
		vi.useRealTimers();
		const { service: tabA } = setup();
		const tabB = TestBed.runInInjectionContext(() => new IdleLockService());
		tabA.start();
		tabB.start();
		const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

		tabA.lock();
		await settle();
		expect(tabB.locked()).toBe(true);

		tabB.unlock();
		await settle();
		expect(tabA.locked()).toBe(false);

		tabA.stop();
		tabB.stop();
	});
});
