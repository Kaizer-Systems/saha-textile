import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TROUBLE_STEPS, troubleFor } from './trouble';

describe('troubleshooting steps', () => {
	it('recognises the failures the console meets', () => {
		expect(troubleFor('A pipeline job is already running (Local pipeline (all stages)).')).toBe('pipeline-busy');
		expect(troubleFor('The checks stage rebuilds the apps under the running dev servers (api). Stop them…')).toBe(
			'checks-refused',
		);
		expect(troubleFor('The Mac helper is not answering. Start it with pnpm console:up.')).toBe('helper');
		expect(troubleFor('Cannot connect to the Docker daemon at unix:///var/run/docker.sock')).toBe('docker');
		expect(troubleFor('MongoServerError: Authentication failed.')).toBe('mongo-login');
		expect(troubleFor('Error: listen EADDRINUSE: address already in use :::4400')).toBe('port-taken');
		expect(troubleFor('write ENOSPC')).toBe('disk');
		expect(troubleFor('Local pipeline (only record): passed.')).toBeNull();
		expect(troubleFor('')).toBeNull();
	});

	it('names only commands that exist in the root package.json', () => {
		const commands = Object.values(TROUBLE_STEPS)
			.flat()
			.flatMap((s) => [...s.matchAll(/`pnpm ([a-z:-]+)`/g)].map((m) => m[1] ?? ''));
		const scripts = (
			JSON.parse(readFileSync(join(process.cwd(), '../../package.json'), 'utf8')) as {
				scripts: Record<string, string>;
			}
		).scripts;
		expect(commands.length).toBeGreaterThan(5);
		expect(commands.filter((c) => !scripts[c])).toEqual([]);
	});
});
