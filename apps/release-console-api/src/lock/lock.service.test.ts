import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LockService, MAX_TRIES } from './lock.service.js';
import { ConsoleStore } from '../store/console-store.js';

/** Everything the database files hold, as text, to prove a value never reached them. */
const databaseText = (dir: string): string =>
	['console.db', 'console.db-wal']
		.map((f) => join(dir, f))
		.filter((f) => existsSync(f))
		.map((f) => readFileSync(f, 'latin1'))
		.join('');

describe('console lock', () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'release-console-lock-'));
		process.env['CONSOLE_DATA_DIR'] = dir;
	});
	afterEach(() => {
		vi.useRealTimers();
		delete process.env['CONSOLE_DATA_DIR'];
	});

	it('sets a PIN once, keeps only its hash, and unlocks with it', () => {
		const lock = new LockService(new ConsoleStore());
		expect(lock.status(undefined)).toMatchObject({ pinSet: false, unlocked: false });
		const session = lock.setup('482913');
		expect(lock.status(session).unlocked).toBe(true);
		expect(databaseText(dir)).not.toContain('482913');
		expect(() => lock.setup('111111')).toThrow(/set already/);
		expect(lock.valid(lock.unlock('482913'))).toBe(true);
	});

	it('locks for 15 minutes after five wrong tries, even after a restart', () => {
		vi.useFakeTimers({ now: new Date('2026-11-10T10:00:00Z') });
		const lock = new LockService(new ConsoleStore());
		lock.setup('482913');
		for (let i = 1; i < MAX_TRIES; i++) expect(() => lock.unlock('000000')).toThrow('Wrong PIN or password.');
		expect(() => lock.unlock('000000')).toThrow(/too many/);
		const restarted = new LockService(new ConsoleStore());
		expect(restarted.status(undefined)).toMatchObject({ triesLeft: 0, lockedUntil: '2026-11-10T10:15:00.000Z' });
		expect(() => restarted.unlock('482913')).toThrow(/too many/);
		vi.setSystemTime(new Date('2026-11-10T10:15:01Z'));
		expect(restarted.valid(restarted.unlock('482913'))).toBe(true);
	});

	it('ends a session after 30 idle minutes and on Lock now', () => {
		vi.useFakeTimers({ now: new Date('2026-11-10T10:00:00Z') });
		const lock = new LockService(new ConsoleStore());
		const a = lock.setup('482913');
		vi.setSystemTime(new Date('2026-11-10T10:31:00Z'));
		expect(lock.valid(a)).toBe(false);
		const b = lock.unlock('482913');
		lock.lock(b);
		expect(lock.valid(b)).toBe(false);
	});

	it('changes the PIN only with the current one', () => {
		const lock = new LockService(new ConsoleStore());
		const s = lock.setup('482913');
		expect(() => lock.changePin(s, '000000', '123456')).toThrow(/current PIN/);
		lock.changePin(s, '482913', '123456');
		expect(lock.valid(lock.unlock('123456'))).toBe(true);
	});

	it('confirms a change with the PIN; wrong PINs count toward the lock and a lock-out ends sessions', () => {
		const lock = new LockService(new ConsoleStore());
		const s = lock.setup('482913');
		expect(() => lock.confirm(s, '482913', 'deploy')).not.toThrow();
		expect(() => lock.confirm(undefined, '482913', 'deploy')).toThrow(/Unlock first/);
		for (let i = 1; i < MAX_TRIES; i++)
			expect(() => lock.confirm(s, '000000', 'deploy')).toThrow('Wrong PIN or password.');
		expect(() => lock.confirm(s, '000000', 'deploy')).toThrow(/too many/);
		expect(lock.valid(s)).toBe(false);
	});

	it('unlocks with a password once one is set, keeps only its hash, and counts its wrong tries too', () => {
		const lock = new LockService(new ConsoleStore());
		const s = lock.setup('482913');
		expect(lock.status(s)).toMatchObject({ passwordSet: false, preferred: 'pin' });
		expect(() => lock.unlock({ password: 'correct horse battery' })).toThrow('Wrong PIN or password.');
		lock.setPassword(s, '482913', 'correct horse battery');
		lock.setPreferred(s, '482913', 'password');
		expect(lock.status(s)).toMatchObject({ passwordSet: true, preferred: 'password', triesLeft: MAX_TRIES });
		expect(lock.valid(lock.unlock({ password: 'correct horse battery' }))).toBe(true);
		expect(lock.valid(lock.unlock({ pin: '482913' }))).toBe(true);
		expect(() => lock.confirm(s, 'correct horse battery', 'deploy')).not.toThrow();
		expect(databaseText(dir)).not.toContain('correct horse battery');
		expect(() => lock.setPassword(s, '000000', 'another long password')).toThrow('Wrong PIN or password.');
		lock.removePassword(s, '482913');
		expect(lock.status(s)).toMatchObject({ passwordSet: false, preferred: 'pin' });
		expect(() => lock.setPreferred(s, '482913', 'password')).toThrow(/Set a password first/);
	});

	it('answers a wrong confirmation with 403, so the open session stays open', () => {
		const lock = new LockService(new ConsoleStore());
		const s = lock.setup('482913');
		try {
			lock.confirm(s, '000000', 'deploy');
		} catch (err) {
			expect((err as { getStatus(): number }).getStatus()).toBe(403);
		}
		expect(lock.valid(s)).toBe(true);
	});
});
