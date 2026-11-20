import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ConsoleStore } from './console-store.js';

describe('console database', () => {
	afterEach(() => {
		delete process.env['CONSOLE_DATA_DIR'];
	});

	it('creates an owner-only database and keeps state and audit across restarts', () => {
		const dir = mkdtempSync(join(tmpdir(), 'release-console-db-'));
		process.env['CONSOLE_DATA_DIR'] = dir;
		const store = new ConsoleStore();
		store.update((f) => ({ ...f, workspaces: ['Kaizer Systems'] }));
		store.audit(null, 'pin-set', 'The console PIN was set');
		store.onModuleDestroy();
		expect(statSync(join(dir, 'console.db')).mode & 0o777).toBe(0o600);
		const again = new ConsoleStore();
		expect(again.read().workspaces).toEqual(['Kaizer Systems']);
		expect(again.auditEntries(null).map((e) => e.action)).toEqual(['pin-set']);
		again.onModuleDestroy();
	});

	it('imports an older console.json and audit.jsonl once, renaming them', () => {
		const dir = mkdtempSync(join(tmpdir(), 'release-console-legacy-'));
		process.env['CONSOLE_DATA_DIR'] = dir;
		writeFileSync(
			join(dir, 'console.json'),
			JSON.stringify({
				version: 1,
				workspaces: ['Clients'],
				projects: [],
				pin: null,
				lock: { failures: 0, lockedUntil: null },
			}),
		);
		writeFileSync(
			join(dir, 'audit.jsonl'),
			`${JSON.stringify({ at: '2026-11-10T13:15:45.824Z', projectId: null, action: 'pin-set', detail: 'x' })}\nnot json\n`,
		);
		const store = new ConsoleStore();
		expect(store.read().workspaces).toEqual(['Clients']);
		expect(store.auditEntries(null)).toHaveLength(1);
		expect(existsSync(join(dir, 'console.json.imported'))).toBe(true);
		expect(existsSync(join(dir, 'audit.jsonl'))).toBe(false);
		store.onModuleDestroy();
	});

	it('filters audit entries by project, newest first', () => {
		process.env['CONSOLE_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'release-console-audit-'));
		const store = new ConsoleStore();
		store.audit('a', 'one', '1');
		store.audit('b', 'two', '2');
		store.audit('a', 'three', '3');
		expect(store.auditEntries('a').map((e) => e.action)).toEqual(['three', 'one']);
		expect(store.auditEntries(null)).toHaveLength(3);
		store.onModuleDestroy();
	});
});
