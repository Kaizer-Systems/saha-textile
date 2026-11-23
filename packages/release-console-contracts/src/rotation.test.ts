import { describe, expect, it } from 'vitest';

import { afterRotate, emptyRotation, graceDaysLeft, rotateRowsOf } from './rotation.js';
import { deployFailureOf, releaseTagTime, startServerDeploySchema } from './server-deploy.js';

const result = (over: Partial<Parameters<typeof afterRotate>[2]> = {}) => ({
	tier: 'staging',
	project: 'saha-textile-staging',
	at: '2026-11-23T10:00:00.000Z',
	changed: [],
	movedToPrevious: [],
	clearedPrevious: [],
	needsRotateDeploy: false,
	...over,
});

describe('secret rotation records (Release Path brief, Part 3)', () => {
	it('keeps database, Redis and search values waiting for a deploy with rotation, and starts the 30 days', () => {
		const next = afterRotate(
			emptyRotation(),
			['redis', 'sign-in', 'csrf'],
			result({
				changed: ['REDIS_PASSWORD', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'CSRF_SECRET'],
				movedToPrevious: ['JWT_ACCESS_SECRET_PREVIOUS', 'JWT_REFRESH_SECRET_PREVIOUS', 'CSRF_SECRET_PREVIOUS'],
				needsRotateDeploy: true,
			}),
		);
		expect(next.pending).toEqual(['redis']);
		expect(next.graceAt).toBe('2026-11-23T10:00:00.000Z');
		expect(graceDaysLeft(next, Date.parse('2026-12-03T10:00:00.000Z'))).toBe(20);
		const cleared = afterRotate(next, [], result({ clearedPrevious: ['CSRF_SECRET_PREVIOUS'] }));
		expect(cleared).toMatchObject({ graceAt: null, graceNames: [], pending: ['redis'] });
		expect(graceDaysLeft(cleared)).toBeNull();
	});

	it('draws one row for the sign-in and CSRF keys together', () => {
		expect(rotateRowsOf(['csrf', 'redis']).map((r) => r.label)).toEqual([
			'Redis password',
			'Sign-in keys and CSRF key',
		]);
	});

	it('rotates the e-invoice and e-way bill key with 30 days of grace and no deploy with rotation', () => {
		expect(rotateRowsOf(['edocs'])[0]).toMatchObject({
			label: 'E-invoice and e-way bill keys',
			scheduled: 'old one kept 30 days · nothing to reconnect',
		});
		const next = afterRotate(
			emptyRotation(),
			['edocs'],
			result({
				changed: ['EDOC_KEYS_KEY'],
				movedToPrevious: ['EDOC_KEYS_KEY_PREVIOUS'],
				needsRotateDeploy: false,
			}),
		);
		expect(next.pending).toEqual([]);
		expect(next.graceNames).toEqual(['EDOC_KEYS_KEY_PREVIOUS']);
	});
});

describe('why a deploy did not go live', () => {
	it('reads the refused data-service secrets after "already run with:"', () => {
		const lines = [
			'2026-11-23T10:01:02.1234567Z Receiving release 20261123-100100-08ac015c',
			'2026-11-23T10:01:05.1234567Z FAILED: This release changes secrets the database, Redis or search already run with: redis-password, mongo-keyfile. Deploy with rotation to apply them; nothing was changed.',
		];
		expect(deployFailureOf(lines)).toEqual({
			kind: 'refused-secrets',
			step: null,
			message:
				'This release changes secrets the database, Redis or search already run with: redis-password, mongo-keyfile. Deploy with rotation to apply them; nothing was changed.',
			names: ['redis-password', 'mongo-keyfile'],
		});
	});

	it('names the failed release step and its message, else the server’s FAILED line', () => {
		expect(
			deployFailureOf([
				'2026-11-23T10:01:02Z ✓ System roles: checked (12 ms)',
				'2026-11-23T10:01:03Z ✗ Database indexes: a unique index on customers.email found duplicate rows (40 ms)',
				'2026-11-23T10:01:04Z FAILED: release steps failed',
			]),
		).toEqual({
			kind: 'release-step',
			step: 'Database indexes',
			message: 'a unique index on customers.email found duplicate rows',
			names: [],
		});
		expect(deployFailureOf(['FAILED: certs/origin.pem has expired.'])).toMatchObject({
			kind: 'stopped',
			message: 'certs/origin.pem has expired.',
		});
		expect(deployFailureOf(['all good'])).toBeNull();
	});

	it('reads a release tag’s time and refuses mixed deploy asks', () => {
		expect(releaseTagTime('staging-20261123-142210-08ac015c')).toBe('2026-11-23T14:22:10Z');
		expect(releaseTagTime('v1.0')).toBeNull();
		const ok = startServerDeploySchema.safeParse({ pin: '135790', action: 'rollback' });
		expect(ok.success).toBe(true);
		expect(startServerDeploySchema.safeParse({ pin: '135790', restartDatabase: true }).success).toBe(false);
		expect(startServerDeploySchema.safeParse({ pin: '135790', tag: 'staging-1' }).success).toBe(false);
	});
});
