import { describe, expect, it } from 'vitest';

import { parseSize, toServices } from './docker-output.js';

const PS = [
	'{"Names":"saha-textile-mongo","Image":"mongo:9.0.4","State":"running","Status":"Up 3 hours (healthy)"}',
	'{"Names":"saha-textile-redis","Image":"redis:8","State":"exited","Status":"Exited (0) 2 minutes ago"}',
	'{"Names":"someone-else","Image":"nginx","State":"running","Status":"Up 1 day"}',
	'not json',
].join('\n');
const STATS = '{"Name":"saha-textile-mongo","CPUPerc":"1.25%","MemUsage":"312.5MiB / 15.59GiB"}\n';

describe('docker output', () => {
	it('keeps only the stack’s containers, sorted, with live numbers when running', () => {
		const rows = toServices(PS, STATS, 'saha-textile');
		expect(rows.map((r) => r.name)).toEqual(['saha-textile-mongo', 'saha-textile-redis']);
		expect(rows[0]).toMatchObject({
			state: 'running',
			health: 'healthy',
			cpuPercent: 1.25,
			memoryBytes: 327680000,
			memoryLimitBytes: Math.round(15.59 * 1024 ** 3),
		});
		expect(rows[1]).toMatchObject({ state: 'exited', health: 'none', cpuPercent: null, memoryBytes: null });
	});

	it('reads health states and treats unknown states as dead', () => {
		const rows = toServices(
			'{"Names":"saha-textile-a","Image":"x","State":"weird","Status":"Up (unhealthy)"}\n{"Names":"saha-textile-b","Image":"x","State":"running","Status":"Up (health: starting)"}',
			'',
			'saha-textile',
		);
		expect(rows.map((r) => [r.state, r.health])).toEqual([
			['dead', 'unhealthy'],
			['running', 'starting'],
		]);
	});

	it('parses sizes and refuses nonsense', () => {
		expect(parseSize('1.5GB')).toBe(1_500_000_000);
		expect(parseSize('512B')).toBe(512);
		expect(parseSize('12 parsecs')).toBeNull();
		expect(parseSize('')).toBeNull();
	});
});
