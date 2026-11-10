import { describe, expect, it } from 'vitest';

import { readinessSchema, servicesSnapshotSchema } from './index.js';

describe('release console contracts', () => {
	it('accepts a services snapshot with unknown live numbers', () => {
		const snapshot = servicesSnapshotSchema.parse({
			environment: 'local',
			readAt: '2026-11-10T07:00:00.000Z',
			services: [
				{
					name: 'saha-textile-mongo',
					image: 'mongo:9.0.4',
					state: 'running',
					health: 'healthy',
					uptime: 'Up 3 hours',
					cpuPercent: null,
					memoryBytes: null,
					memoryLimitBytes: null,
				},
			],
		});
		expect(snapshot.services).toHaveLength(1);
	});

	it('rejects an unknown container state', () => {
		expect(() =>
			servicesSnapshotSchema.parse({
				environment: 'local',
				readAt: '2026-11-10T07:00:00.000Z',
				services: [
					{
						name: 'x',
						image: 'y',
						state: 'sleeping',
						health: 'none',
						uptime: '',
						cpuPercent: 0,
						memoryBytes: 0,
						memoryLimitBytes: 0,
					},
				],
			}),
		).toThrow();
	});

	it('accepts a degraded readiness answer', () => {
		expect(
			readinessSchema.parse({
				environment: 'production',
				reachable: true,
				status: 'degraded',
				checkedAt: '2026-11-10T07:00:00.000Z',
			}).status,
		).toBe('degraded');
	});
});
