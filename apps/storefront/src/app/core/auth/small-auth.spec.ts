import { ApplicationInitStatus, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { abandonSignupGuard } from '@core/guards/abandon-signup.guard';
import { AuthStore } from '@core/state/auth.store';

import { refusalCode } from './refusal-code';
import { ResendCountdown, resendDelaySeconds } from './resend-countdown';
import { provideSessionBootstrap } from './session-bootstrap';

vi.mock('@core/config/runtime-config', () => ({ runtimeConfigReady: Promise.resolve() }));

afterEach(() => vi.useRealTimers());

describe('refusalCode', () => {
	it('falls back for something that is not an object, or runs too deep', () => {
		expect(refusalCode('text', 'fallback')).toBe('fallback');
		expect(refusalCode({ error: { error: { error: { code: 'x' } } } }, 'fallback')).toBe('fallback');
	});

	it('falls back for issues with no usable code', () => {
		expect(refusalCode({ issues: [{ message: 'x' }] }, 'fallback')).toBe('fallback');
	});
});

describe('ResendCountdown', () => {
	const countdown = () => TestBed.runInInjectionContext(() => new ResendCountdown());

	it('has no delay before the first send', () => {
		expect(resendDelaySeconds(0)).toBe(0);
		expect(resendDelaySeconds(1)).toBe(30);
		expect(resendDelaySeconds(99)).toBe(3600);
	});

	it('ticks down and stops at zero', () => {
		vi.useFakeTimers();
		const timer = countdown();
		timer.start(new Date(Date.now() + 2000).toISOString());
		expect(timer.waiting).toBe(true);
		vi.advanceTimersByTime(1000);
		expect(timer.secondsRemaining()).toBe(1);
		vi.advanceTimersByTime(1000);
		expect(timer.waiting).toBe(false);
		vi.advanceTimersByTime(5000);
		expect(timer.secondsRemaining()).toBe(0);
	});

	it('has no wait when the server says it has passed', () => {
		const timer = countdown();
		timer.start(new Date(Date.now() - 1000).toISOString());
		expect(timer.waiting).toBe(false);
	});

	it('follows the schedule without a server time', () => {
		vi.useFakeTimers();
		const timer = countdown();
		timer.start();
		expect(timer.secondsRemaining()).toBe(30);
		timer.reset();
		expect(timer.secondsRemaining()).toBe(0);
	});
});

describe('provideSessionBootstrap', () => {
	const boot = async (platform: string) => {
		const store = { bootstrap: vi.fn(async () => undefined) };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: AuthStore, useValue: store },
				{ provide: PLATFORM_ID, useValue: platform },
				provideSessionBootstrap(),
			],
		});
		await TestBed.inject(ApplicationInitStatus).donePromise;
		return store;
	};

	it('resolves the session in the browser', async () => {
		expect((await boot('browser')).bootstrap).toHaveBeenCalledOnce();
	});

	it('skips the server', async () => {
		expect((await boot('server')).bootstrap).not.toHaveBeenCalled();
	});
});

describe('abandonSignupGuard', () => {
	it('abandons the signup and lets the person leave', () => {
		const leaveSignup = vi.fn();
		expect(abandonSignupGuard({ leaveSignup } as never, {} as never, {} as never, {} as never)).toBe(true);
		expect(leaveSignup).toHaveBeenCalledOnce();
	});
});
