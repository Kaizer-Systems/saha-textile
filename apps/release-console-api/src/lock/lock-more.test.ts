import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LockService, MAX_TRIES } from './lock.service.js';
import { SessionGuard, sessionOf } from './session.guard.js';
import { ConsoleStore } from '../store/console-store.js';

import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

beforeEach(() => {
	process.env['CONSOLE_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'release-console-lock-more-'));
});
afterEach(() => {
	delete process.env['CONSOLE_DATA_DIR'];
});

describe('the console lock', () => {
	it('needs a PIN before unlocking or confirming, and refuses while locked out', () => {
		const lock = new LockService(new ConsoleStore());
		expect(() => lock.unlock('123456')).toThrow('Set a PIN first.');
		const session = lock.setup('123456');
		expect(() => lock.confirm(undefined, '123456', 'x')).toThrow('Unlock first.');
		for (let i = 0; i < MAX_TRIES; i++) expect(() => lock.unlock('000000')).toThrow();
		expect(() => lock.unlock('123456')).toThrow('Locked after too many wrong tries.');
		expect(lock.valid(session)).toBe(true);
		// The open session stays, but it confirms nothing while the lock-out lasts.
		expect(() => lock.confirm(session, '123456', 'x')).toThrow('Locked after too many wrong tries.');
		expect(() => lock.changePin(undefined, '123456', '654321')).toThrow('Unlock first.');
	});

	it('words the sign-in method, and locks without a session', () => {
		const lock = new LockService(new ConsoleStore());
		const session = lock.setup('123456');
		lock.setPassword(session, '123456', 'a long password here');
		lock.setPreferred(session, '123456', 'password');
		lock.setPreferred(session, '123456', 'pin');
		expect(lock.status(session).preferred).toBe('pin');
		lock.lock(undefined);
		expect(lock.valid(session)).toBe(true);
	});
});

describe('the session guard', () => {
	const context = (headers: Record<string, string | string[] | undefined>) =>
		({
			getHandler: () => undefined,
			getClass: () => undefined,
			switchToHttp: () => ({ getRequest: () => ({ headers }) }),
		}) as unknown as ExecutionContext;

	it('lets open routes and unlocked sessions through, and refuses the rest', () => {
		const lock = { valid: vi.fn((s?: string) => s === 'good') } as unknown as LockService;
		const reflector = (open: boolean) => ({ getAllAndOverride: () => open }) as unknown as Reflector;
		expect(new SessionGuard(reflector(true), lock).canActivate(context({}))).toBe(true);
		const guard = new SessionGuard(reflector(false), lock);
		expect(guard.canActivate(context({ 'x-console-session': ['good', 'other'] }))).toBe(true);
		expect(() => guard.canActivate(context({ 'x-console-session': 'bad' }))).toThrow('The console is locked.');
		expect(sessionOf({ headers: {} })).toBeUndefined();
	});
});
