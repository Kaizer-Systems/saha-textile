import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { describe, expect, it, vi } from 'vitest';

import { LockPage } from './lock-page';
import { ConsoleApi } from '../data/console-api';
import { ConsoleSession } from '../data/session';

/** The page's members these tests use (protected on the component). */
interface Page {
	pin: { set(v: string): void };
	first: () => string | null;
	message: () => string;
	busy: { set(v: boolean): void; (): boolean };
	method: () => string;
	password: { set(v: string): void; (): string };
	status: { data: () => unknown };
	useMethod(m: 'pin' | 'password'): void;
	submit(e?: Event): Promise<void>;
}

const STATUS = { unlocked: false, pinSet: true, passwordSet: true, preferred: 'password', lockedUntil: null };

function make(status: Record<string, unknown>, api: Record<string, unknown> = {}) {
	const lockStatus = vi.fn(async () => ({ ...STATUS, ...status }));
	const calls = {
		lockStatus,
		unlock: vi.fn(async () => ({ session: 'session-1' })),
		setupPin: vi.fn(async () => ({ session: 'session-2' })),
		...api,
	};
	const router = { navigate: vi.fn(async () => true) };
	const clear = vi.fn();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ConsoleApi, useValue: calls },
			{ provide: Router, useValue: router },
		],
	});
	TestBed.overrideComponent(LockPage, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(LockPage);
	const c = fixture.componentInstance as unknown as Page;
	// The PIN boxes and the password box, as the page's template would draw them.
	const box = document.createElement('input');
	const focus = vi.spyOn(box, 'focus');
	Object.defineProperty(c, 'pins', { value: () => ({ clear }) });
	Object.defineProperty(c, 'passwordBox', { value: () => ({ nativeElement: box }) });
	fixture.detectChanges();
	return { c, api: calls, router, clear, focus, fixture, session: TestBed.inject(ConsoleSession) };
}

describe('the lock page', () => {
	it('opens with the password when that is the chosen way in, and focuses its box', async () => {
		const { c, router, focus, fixture } = make({});
		await vi.waitFor(() => expect(c.status.data()).toBeTruthy());
		fixture.detectChanges();
		expect(c.method()).toBe('password');
		await vi.waitFor(() => expect(focus).toHaveBeenCalled());
		expect(router.navigate).not.toHaveBeenCalled();
	});

	it('goes straight in when the console is already unlocked, and opens with the PIN without a password', async () => {
		const unlocked = make({ unlocked: true });
		await vi.waitFor(() => expect(unlocked.router.navigate).toHaveBeenCalledWith(['/']));
		const noPassword = make({ passwordSet: false });
		await vi.waitFor(() => expect(noPassword.c.status.data()).toBeTruthy());
		noPassword.fixture.detectChanges();
		expect(noPassword.c.method()).toBe('pin');
	});

	it('unlocks with the password, waits for one, and says when it is refused', async () => {
		const { c, api, session } = make({});
		await vi.waitFor(() => expect(c.status.data()).toBeTruthy());
		await c.submit({ preventDefault: vi.fn() } as unknown as Event);
		expect(api.unlock).not.toHaveBeenCalled();
		c.password.set('correct horse');
		await c.submit();
		expect(api.unlock).toHaveBeenCalledWith({ password: 'correct horse' });
		expect(session.token()).toBe('session-1');
		api.unlock.mockRejectedValueOnce(new Error('Wrong password'));
		c.password.set('wrong');
		await c.submit();
		expect(c.message()).toBe('Wrong password');
		expect(c.password()).toBe('');
	});

	it('unlocks with the PIN once all six are typed, and empties the boxes when it is refused', async () => {
		const { c, api, clear } = make({ preferred: 'pin' });
		await vi.waitFor(() => expect(c.status.data()).toBeTruthy());
		c.useMethod('password');
		expect(c.method()).toBe('password');
		c.useMethod('pin');
		expect(clear).toHaveBeenCalled();
		c.pin.set('123');
		await c.submit();
		expect(api.unlock).not.toHaveBeenCalled();
		c.pin.set('123456');
		c.busy.set(true);
		await c.submit();
		expect(api.unlock).not.toHaveBeenCalled();
		c.busy.set(false);
		await c.submit();
		expect(api.unlock).toHaveBeenCalledWith({ pin: '123456' });
		api.unlock.mockRejectedValueOnce(new Error('Wrong PIN'));
		clear.mockClear();
		await c.submit();
		expect(c.message()).toBe('Wrong PIN');
		expect(clear).toHaveBeenCalled();
	});

	it('sets a first PIN typed twice, starts again when they differ, and says when setting it fails', async () => {
		const { c, api, session } = make({ pinSet: false, passwordSet: false });
		await vi.waitFor(() => expect(c.status.data()).toBeTruthy());
		c.pin.set('111111');
		await c.submit();
		expect(c.first()).toBe('111111');
		c.pin.set('222222');
		await c.submit();
		expect(c.message()).toBe('The two PINs differ. Start again.');
		expect(c.first()).toBeNull();
		c.pin.set('333333');
		await c.submit();
		await c.submit();
		expect(api.setupPin).toHaveBeenCalledWith('333333');
		expect(session.token()).toBe('session-2');
		// The confirmed PIN stays chosen: sending it again reaches the API, which may refuse it.
		api.setupPin.mockRejectedValueOnce(new Error('Already set'));
		await c.submit();
		expect(c.message()).toBe('Already set');
	});

	it('does nothing before the status is read', async () => {
		const { c, api } = make({}, { lockStatus: vi.fn(() => new Promise(() => undefined)) });
		c.pin.set('123456');
		await c.submit();
		expect(api.unlock).not.toHaveBeenCalled();
	});
});
