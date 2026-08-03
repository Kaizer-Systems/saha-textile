import { describe, expect, it } from 'vitest';

import { RefreshCoordinator } from '../src/refresh-coordinator.js';

/** A promise whose settlement this test controls, so concurrency is deterministic. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('RefreshCoordinator', () => {
	// The whole point: concurrent 401s must produce ONE rotation. Two rotations race for the
	// same opaque refresh token, and the loser looks like a stolen token to the API's reuse
	// detection — which revokes the entire family and signs the user out.
	it('runs the operation once for callers that arrive while a rotation is in flight', async () => {
		const gate = deferred<string>();
		let calls = 0;
		const coordinator = new RefreshCoordinator<string>();
		const operation = () => {
			calls += 1;
			return gate.promise;
		};

		const first = coordinator.run(operation);
		const second = coordinator.run(operation);
		const third = coordinator.run(operation);

		expect(calls).toBe(1);
		expect(second).toBe(first);
		expect(third).toBe(first);

		gate.resolve('rotated');
		await expect(Promise.all([first, second, third])).resolves.toEqual(['rotated', 'rotated', 'rotated']);
	});

	it('reports whether a rotation is outstanding', async () => {
		const gate = deferred<void>();
		const coordinator = new RefreshCoordinator();

		expect(coordinator.isRefreshing).toBe(false);
		const run = coordinator.run(() => gate.promise);
		expect(coordinator.isRefreshing).toBe(true);

		gate.resolve();
		await run;
		expect(coordinator.isRefreshing).toBe(false);
	});

	it('starts a new rotation once the previous one has settled', async () => {
		let calls = 0;
		const coordinator = new RefreshCoordinator<number>();
		const operation = () => Promise.resolve(++calls);

		await expect(coordinator.run(operation)).resolves.toBe(1);
		await expect(coordinator.run(operation)).resolves.toBe(2);
		expect(calls).toBe(2);
	});

	// A rejection must reach every joined caller: each decides whether to sign out. Swallowing
	// it here would leave them retrying against a session that is already gone.
	it('rejects every joined caller with the same error', async () => {
		const gate = deferred<void>();
		const coordinator = new RefreshCoordinator();
		const failure = new Error('refresh failed');

		const first = coordinator.run(() => gate.promise);
		const second = coordinator.run(() => gate.promise);

		gate.reject(failure);

		await expect(first).rejects.toBe(failure);
		await expect(second).rejects.toBe(failure);
	});

	// If a failure left the slot occupied, no refresh would ever be attempted again and the
	// app would be permanently unable to recover a session.
	it('does not wedge after a failed rotation', async () => {
		const coordinator = new RefreshCoordinator<string>();

		await expect(coordinator.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
		expect(coordinator.isRefreshing).toBe(false);
		await expect(coordinator.run(() => Promise.resolve('recovered'))).resolves.toBe('recovered');
	});

	// Without the try/catch the slot is never assigned and the throw escapes past bookkeeping.
	it('converts a synchronous throw into a rejection and stays usable', async () => {
		const coordinator = new RefreshCoordinator<string>();

		await expect(
			coordinator.run(() => {
				throw new Error('sync boom');
			}),
		).rejects.toThrow('sync boom');
		expect(coordinator.isRefreshing).toBe(false);
		await expect(coordinator.run(() => Promise.resolve('ok'))).resolves.toBe('ok');
	});

	it('abandons the tracked rotation on reset so the next caller starts fresh', async () => {
		const gate = deferred<string>();
		let calls = 0;
		const coordinator = new RefreshCoordinator<string>();

		const abandoned = coordinator.run(() => {
			calls += 1;
			return gate.promise;
		});
		coordinator.reset();
		expect(coordinator.isRefreshing).toBe(false);

		const restarted = coordinator.run(() => {
			calls += 1;
			return Promise.resolve('fresh');
		});

		expect(calls).toBe(2);
		expect(restarted).not.toBe(abandoned);
		await expect(restarted).resolves.toBe('fresh');

		gate.resolve('stale');
		await expect(abandoned).resolves.toBe('stale');
	});

	// Default is unlatched: a failure is a failure, not a verdict about the session.
	it('keeps attempting after a failure unless the latch is enabled', async () => {
		const coordinator = new RefreshCoordinator<string>();

		await expect(coordinator.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
		expect(coordinator.isLatched).toBe(false);
		await expect(coordinator.run(() => Promise.resolve('again'))).resolves.toBe('again');
	});

	// The abandoned rotation settling later must not clear the slot belonging to the newer one.
	it('a late-settling abandoned rotation does not clear a newer in-flight slot', async () => {
		const stale = deferred<string>();
		const fresh = deferred<string>();
		const coordinator = new RefreshCoordinator<string>();

		const abandoned = coordinator.run(() => stale.promise);
		coordinator.reset();
		const current = coordinator.run(() => fresh.promise);

		stale.resolve('stale');
		await abandoned;

		expect(coordinator.isRefreshing).toBe(true);
		expect(coordinator.run(() => Promise.resolve('should not run'))).toBe(current);

		fresh.resolve('fresh');
		await expect(current).resolves.toBe('fresh');
		expect(coordinator.isRefreshing).toBe(false);
	});
});

describe('RefreshCoordinator with latchOnFailure', () => {
	// Loop prevention. Without the latch, an anonymous visitor pays one pointless refresh per
	// 401, and a page firing several protected requests keeps re-asking a settled question.
	it('refuses further attempts after a failure', async () => {
		let calls = 0;
		const coordinator = new RefreshCoordinator<string>({ latchOnFailure: true });
		const failing = () => {
			calls += 1;
			return Promise.reject(new Error('no session'));
		};

		await expect(coordinator.run(failing)).rejects.toThrow('no session');
		expect(coordinator.isLatched).toBe(true);

		await expect(coordinator.run(failing)).rejects.toThrow('no session');
		await expect(coordinator.run(failing)).rejects.toThrow('no session');
		expect(calls).toBe(1);
	});

	// The reason a request gave up should be the real one, not a synthetic placeholder.
	it('replays the original failure to latched callers', async () => {
		const failure = new Error('refresh returned 401');
		const coordinator = new RefreshCoordinator({ latchOnFailure: true });

		await expect(coordinator.run(() => Promise.reject(failure))).rejects.toBe(failure);
		await expect(coordinator.run(() => Promise.resolve())).rejects.toBe(failure);
	});

	it('latches on a synchronous throw as well', async () => {
		const coordinator = new RefreshCoordinator<string>({ latchOnFailure: true });

		await expect(
			coordinator.run(() => {
				throw new Error('sync boom');
			}),
		).rejects.toThrow('sync boom');
		expect(coordinator.isLatched).toBe(true);
	});

	// Authenticating again is what makes the earlier verdict obsolete.
	it('resumes attempting after reset', async () => {
		const coordinator = new RefreshCoordinator<string>({ latchOnFailure: true });

		await expect(coordinator.run(() => Promise.reject(new Error('gone')))).rejects.toThrow('gone');
		coordinator.reset();

		expect(coordinator.isLatched).toBe(false);
		await expect(coordinator.run(() => Promise.resolve('rotated'))).resolves.toBe('rotated');
	});

	it('does not latch on success', async () => {
		const coordinator = new RefreshCoordinator<string>({ latchOnFailure: true });

		await expect(coordinator.run(() => Promise.resolve('ok'))).resolves.toBe('ok');
		expect(coordinator.isLatched).toBe(false);
		await expect(coordinator.run(() => Promise.resolve('ok again'))).resolves.toBe('ok again');
	});

	// Callers that joined the losing rotation must still see the real rejection, not the
	// immediate latched short-circuit meant for callers arriving afterwards.
	it('rejects joined callers with the failure and latches once', async () => {
		const gate = deferred<void>();
		let calls = 0;
		const coordinator = new RefreshCoordinator({ latchOnFailure: true });
		const operation = () => {
			calls += 1;
			return gate.promise;
		};
		const failure = new Error('expired');

		const first = coordinator.run(operation);
		const second = coordinator.run(operation);
		gate.reject(failure);

		await expect(first).rejects.toBe(failure);
		await expect(second).rejects.toBe(failure);
		expect(calls).toBe(1);
		expect(coordinator.isLatched).toBe(true);
	});
});
