import { describe, expect, it } from 'vitest';

import { formatRate, percent, sparkPoints } from './local-parts';
import { containerRates, readLogLine, stageLane } from './local-screens';

import type { DockerSnapshot, Job, JobLine } from '@saha-textile/release-console-contracts';

const ev = (seq: number, event: Record<string, unknown>): JobLine => ({
	seq,
	stream: 'out',
	text: JSON.stringify(event),
	event,
});

describe('local screens', () => {
	it('reads the apps’ JSON log lines, Nginx request lines and plain lines', () => {
		const api = readLogLine(
			'2026-11-20T07:01:02.123456Z {"level":"error","message":"Payment failed","context":"Orders","requestId":"0123456789abcdef0123456789abcdef"}',
		);
		expect(api).toMatchObject({
			time: '07:01:02',
			level: 'err',
			source: 'Orders',
			message: 'Payment failed',
			requestId: '0123456789abcdef0123456789abcdef',
		});
		const edge = readLogLine(
			'2026-11-20T07:01:03Z {"method":"GET","uri":"/api/x","status":502,"request_time":"0.120"}',
		);
		expect(edge).toMatchObject({ level: 'err', source: 'edge', message: 'GET /api/x → 502 · 0.120s' });
		expect(readLogLine('2026-11-20T07:01:04Z WARN something odd').level).toBe('warn');
	});

	it('draws the pipeline lane from the run’s events, marking stages left out of the run', () => {
		const job = {
			id: 'j',
			kind: 'pipeline',
			label: 'Local pipeline (from proof)',
			status: 'running',
			startedAt: 't',
			finishedAt: null,
			exitCode: null,
			lines: [],
		} as Job;
		const lane = stageLane(
			job,
			[
				ev(1, { stage: 'proof', status: 'started' }),
				ev(2, { stage: 'proof', status: 'passed', seconds: 231.4 }),
				ev(3, { stage: 'images', status: 'started' }),
			],
			{ from: 'proof' },
		);
		expect(lane.map((s) => [s.stage, s.cls, s.time])).toEqual([
			['checks', 'skip', 'not in this run'],
			['proof', 'ok', '231s'],
			['images', 'run', 'running…'],
			['release', 'wait', 'waiting'],
			['deploy', 'wait', 'waiting'],
			['record', 'wait', 'waiting'],
		]);
		const failed = stageLane(
			{ ...job, status: 'failed' },
			[ev(1, { stage: 'release', status: 'failed', reason: 'MSG91_AUTH_KEY blank' })],
			{ only: 'release' },
		);
		expect(failed.find((s) => s.stage === 'release')?.cls).toBe('red');
	});

	it('turns two Docker readings into per-second rates', () => {
		const at = (t: string, rx: number): DockerSnapshot => ({
			at: t,
			reachable: true,
			version: '29',
			cpus: 1,
			memoryTotal: 1,
			containers: [],
			stats: [
				{
					name: 'a',
					cpuPercent: 1,
					memoryBytes: 1,
					memoryLimitBytes: 2,
					netRxBytes: rx,
					netTxBytes: 0,
					blockReadBytes: 0,
					blockWriteBytes: 0,
					pids: 1,
				},
			],
		});
		expect(containerRates(at('2026-11-20T07:00:00Z', 1000), at('2026-11-20T07:00:05Z', 6000)).get('a')?.rx).toBe(
			1000,
		);
		expect(containerRates(null, at('2026-11-20T07:00:05Z', 6000)).get('a')?.rx).toBeNull();
	});

	it('formats rates and percents, and draws a sparkline only from two points', () => {
		expect(formatRate(1536)).toBe('1.5 KB/s');
		expect(formatRate(null)).toBe('—');
		expect(percent(50, 200)).toBe(25);
		expect(percent(null, 200)).toBe(0);
		expect(sparkPoints([1])).toBe('');
		expect(sparkPoints([0, 10], 300, 70, 10).split(' ')).toEqual(['0.0,67.0', '300.0,3.0']);
	});
});
