import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, ConsoleApi } from './console-api';
import { ConsoleSession } from './session';

/**
 * Every call of the console's data layer, made against a local stand-in for the console API: an
 * answer it cannot read (so the check refuses it), a 401 that locks the console, and refusals with
 * and without a message. The real answers are checked in each screen's own tests; this makes sure
 * no call is left unexercised. Nothing leaves this machine: fetch answers locally.
 */
interface Reply {
	status: number;
	body: unknown;
}
let reply: Reply = { status: 200, body: {} };
const calls: string[] = [];
const fetchStub = vi.fn(async (url: string) => {
	calls.push(String(url));
	return new Response(reply.body === undefined ? 'not json' : JSON.stringify(reply.body), { status: reply.status });
});

const REPLIES: Reply[] = [
	{ status: 200, body: {} },
	{ status: 401, body: { message: 'locked' } },
	{ status: 500, body: { message: 'Something broke' } },
	{ status: 500, body: 'text' },
	{ status: 503, body: undefined },
];

const ARGS: unknown[][] = [
	['proj_1', 'shop', 'staging', { pin: '123456' }, 'x'],
	['proj_1', 'shop', 'production', { source: 'ci', run: '1' }, { a: 1 }],
	// A server deploy with its typed confirmation and a branch.
	['proj_1', 'shop', 'staging', '123456', [], 'staging', 'main'],
	[],
];

async function settle(run: () => unknown): Promise<void> {
	try {
		const result = run();
		if (result && typeof (result as Promise<unknown>).then === 'function') await result;
	} catch {
		// A refused answer is part of what is exercised.
	}
}

afterEach(() => {
	vi.unstubAllGlobals();
	calls.length = 0;
	sessionStorage.clear();
});

describe('every call of the console data layer', () => {
	it('asks the console API for each one, and reads its refusals', async () => {
		vi.stubGlobal('fetch', fetchStub);
		TestBed.resetTestingModule();
		// Any address is a page here: a 401 sends the console to /lock, which must not fail the navigation.
		TestBed.configureTestingModule({
			providers: [provideRouter([{ path: '**', children: [] }]), provideTanStackQuery(new QueryClient())],
		});
		const api = TestBed.inject(ConsoleApi) as unknown as Record<string, (...args: unknown[]) => unknown>;
		const session = TestBed.inject(ConsoleSession);
		const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(api)).filter(
			(key) => key !== 'constructor' && typeof api[key] === 'function',
		);
		for (const next of REPLIES) {
			reply = next;
			session.set('token-1');
			for (const method of methods) for (const args of ARGS) await settle(() => api[method]?.(...args));
		}
		expect(calls.length).toBeGreaterThan(methods.length);
		expect(session.token()).toBeNull();
	}, 60_000);

	it('names a refusal with the status and its message', () => {
		const error = new ApiError('Something broke', 500);
		expect(error.message).toBe('Something broke');
		expect(error.status).toBe(500);
	});
});
