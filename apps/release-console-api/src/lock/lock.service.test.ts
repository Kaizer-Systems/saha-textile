import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LockService, MAX_TRIES } from './lock.service.js';
import { ConsoleStore } from '../store/console-store.js';

describe('console lock', () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'release-console-lock-'));
		process.env['CONSOLE_DATA_DIR'] = dir;
		process.env['CONSOLE_SEED_FILE'] = resolve(__dirname, '../../../../.release-console.json');
	});
	afterEach(() => {
		vi.useRealTimers();
		delete process.env['CONSOLE_DATA_DIR'];
		delete process.env['CONSOLE_SEED_FILE'];
	});

	it('sets a PIN once, keeps only its hash, and unlocks with it', () => {
		const lock = new LockService(new ConsoleStore());
		expect(lock.status(undefined)).toMatchObject({ pinSet: false, unlocked: false });
		const session = lock.setup('482913');
		expect(lock.status(session).unlocked).toBe(true);
		expect(readFileSync(join(dir, 'console.json'), 'utf8')).not.toContain('482913');
		expect(() => lock.setup('111111')).toThrow(/set already/);
		expect(lock.valid(lock.unlock('482913'))).toBe(true);
	});

	it('locks for 15 minutes after five wrong tries, even after a restart', () => {
		vi.useFakeTimers({ now: new Date('2026-11-10T10:00:00Z') });
		const lock = new LockService(new ConsoleStore());
		lock.setup('482913');
		for (let i = 1; i < MAX_TRIES; i++) expect(() => lock.unlock('000000')).toThrow('Wrong PIN.');
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
});
