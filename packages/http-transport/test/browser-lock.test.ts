import { afterEach, describe, expect, it } from 'vitest';

import { withBrowserLock } from '../src/browser-lock.js';
import type { LockManagerLike } from '../src/browser-lock.js';

/** A minimal serialising lock manager, so ordering can be observed rather than assumed. */
function fakeLocks(): LockManagerLike & { held: string[] } {
	let tail: Promise<unknown> = Promise.resolve();
	const held: string[] = [];

	return {
		held,
		request<T>(name: string, callback: () => Promise<T>): Promise<T> {
			const run = tail.then(() => {
				held.push(name);
				return callback();
			});
			// Keep the chain alive even when one holder rejects, or a single failure would
			// wedge every later waiter.
			tail = run.catch(() => undefined);
			return run;
		},
	};
}

describe('withBrowserLock', () => {
	it('runs the work while holding the named lock', async () => {
		const locks = fakeLocks();

		await expect(withBrowserLock('session-refresh', () => Promise.resolve('done'), locks)).resolves.toBe('done');
		expect(locks.held).toEqual(['session-refresh']);
	});

	// The whole point: two tabs must not rotate at the same moment.
	it('serialises concurrent holders', async () => {
		const locks = fakeLocks();
		const order: string[] = [];
		const work = (label: string) => async () => {
			order.push(`${label}:start`);
			await Promise.resolve();
			order.push(`${label}:end`);
		};

		await Promise.all([
			withBrowserLock('session-refresh', work('a'), locks),
			withBrowserLock('session-refresh', work('b'), locks),
		]);

		expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
	});

	it('propagates the failure and still releases for the next holder', async () => {
		const locks = fakeLocks();

		await expect(
			withBrowserLock('session-refresh', () => Promise.reject(new Error('boom')), locks),
		).rejects.toThrow('boom');
		await expect(withBrowserLock('session-refresh', () => Promise.resolve('after'), locks)).resolves.toBe('after');
	});

	// Falling through leaves the caller exactly as exposed as before locking existed. Refusing
	// to run would trade a narrow race for a certain logout.
	it('runs the work directly when locking is unavailable', async () => {
		await expect(withBrowserLock('session-refresh', () => Promise.resolve('ran'), null)).resolves.toBe('ran');
	});

	it('runs the work directly when the lock manager rejects the request outright', async () => {
		const hostile: LockManagerLike = {
			request() {
				throw new Error('SecurityError: insecure context');
			},
		};

		await expect(withBrowserLock('session-refresh', () => Promise.resolve('ran'), hostile)).resolves.toBe('ran');
	});

	describe('ambient detection', () => {
		afterEach(() => {
			delete (globalThis as { navigator?: unknown }).navigator;
		});

		// jsdom implements BroadcastChannel but not `navigator.locks`, and there is no
		// navigator at all under server rendering — both must degrade, not throw.
		it('falls through when there is no navigator', async () => {
			await expect(withBrowserLock('session-refresh', () => Promise.resolve('ran'))).resolves.toBe('ran');
		});

		it('falls through when navigator exposes no locks', async () => {
			(globalThis as { navigator?: unknown }).navigator = {};
			await expect(withBrowserLock('session-refresh', () => Promise.resolve('ran'))).resolves.toBe('ran');
		});

		it('falls through when locks is present but not a lock manager', async () => {
			(globalThis as { navigator?: unknown }).navigator = { locks: { request: 'not a function' } };
			await expect(withBrowserLock('session-refresh', () => Promise.resolve('ran'))).resolves.toBe('ran');
		});

		it('uses the ambient lock manager when one is present', async () => {
			const locks = fakeLocks();
			(globalThis as { navigator?: unknown }).navigator = { locks };

			await expect(withBrowserLock('session-refresh', () => Promise.resolve('locked'))).resolves.toBe('locked');
			expect(locks.held).toEqual(['session-refresh']);
		});
	});
});
