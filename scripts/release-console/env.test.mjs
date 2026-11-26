import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { CONSOLE_ENV_FILE, CONSOLE_KEY_NAMES, buildConsoleEnv, writeConsoleEnv } from './env.mjs';
import { SecretsError } from '../secrets/inventory.mjs';

const ROOT = join(import.meta.dirname, '../..');

/** A temporary root, so the test writes nowhere real. */
const tempRoot = () => mkdtempSync(join(tmpdir(), 'console-env-'));
const project = { name: 'saha-textile-local', environment: 'dev', projectId: 'test-project' };

test('lists the names the console API reads, and reports missing ones by name only', () => {
	const built = buildConsoleEnv(
		new Map([
			['CONSOLE_DO_READ_TOKEN', 'test-value-1'],
			['CONSOLE_CF_WRITE_TOKEN', ''],
			['CONSOLE_SENTRY_KEY', 'test-value-2'],
		]),
		{ source: 'test' },
	);
	assert.deepEqual(built.names, ['CONSOLE_DO_READ_TOKEN', 'CONSOLE_SENTRY_KEY']);
	assert.ok(built.missing.includes('CONSOLE_GITHUB_TOKEN'));
	assert.ok(!built.missing.includes('CONSOLE_CF_WRITE_TOKEN'));
	assert.deepEqual(built.optionalBlank, [
		'CONSOLE_CF_USER_TOKEN',
		'CONSOLE_CF_WRITE_TOKEN',
		'CONSOLE_DO_WRITE_TOKEN',
		'CONSOLE_OPS_TOKEN_DEV',
		'CONSOLE_OPS_TOKEN_LOCAL',
		'CONSOLE_OPS_TOKEN_PRODUCTION',
		'CONSOLE_OPS_TOKEN_STAGING',
		'GOOGLE_SEARCH_CONSOLE_KEY',
	]);
	assert.deepEqual(built.extra, ['CONSOLE_SENTRY_KEY']);
	assert.match(built.text, /^CONSOLE_DO_READ_TOKEN=test-value-1$/m);
	assert.doesNotMatch(built.text, /CONSOLE_CF_WRITE_TOKEN/);
});

test('writes an owner-only file and prints no value', () => {
	const root = tempRoot();
	const { ok, lines } = writeConsoleEnv({
		root,
		project,
		read: () => new Map([['CONSOLE_DO_READ_TOKEN', 'test-value-3']]),
	});
	assert.equal(ok, true);
	assert.equal(statSync(join(root, CONSOLE_ENV_FILE)).mode & 0o777, 0o600);
	assert.match(readFileSync(join(root, CONSOLE_ENV_FILE), 'utf8'), /test-value-3/);
	assert.ok(!lines.join('\n').includes('test-value-3'));
});

test('keeps the last file when Infisical cannot be read, and fails when there is none', () => {
	const root = tempRoot();
	const refuse = () => {
		throw new SecretsError('Sign in with: infisical login.');
	};
	assert.equal(writeConsoleEnv({ root, project, read: refuse }).ok, false);
	mkdirSync(join(root, 'docker/release-console/env'), { recursive: true });
	writeFileSync(join(root, CONSOLE_ENV_FILE), 'CONSOLE_DO_READ_TOKEN=test-value-4\n');
	const kept = writeConsoleEnv({ root, project, read: refuse });
	assert.equal(kept.ok, true);
	assert.match(kept.lines[0], /is kept \(1 names\)/);
	assert.ok(!kept.lines.join('\n').includes('test-value-4'));
});

test('the API reads every name this script writes', () => {
	const api = readFileSync(join(ROOT, 'apps/release-console-api/src/keys/console-key-names.ts'), 'utf8');
	for (const name of CONSOLE_KEY_NAMES) assert.match(api, new RegExp(`'${name}'`));
});

test('a read and change pair is complete when either key is filled', async () => {
	const { missingNames } = await import('./env.mjs');
	assert.ok(!missingNames(['CONSOLE_DO_WRITE_TOKEN']).includes('CONSOLE_DO_READ_TOKEN'));
	assert.ok(missingNames([]).includes('CONSOLE_DO_READ_TOKEN'));
	assert.ok(!missingNames([]).includes('CONSOLE_DO_WRITE_TOKEN'));
	assert.ok(!missingNames(['CONSOLE_CF_READ_TOKEN']).includes('CONSOLE_CF_READ_TOKEN'));
});
