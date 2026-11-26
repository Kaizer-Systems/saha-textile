import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import type { AuditLog } from '@saha-textile/contracts';
import { GIB, STORAGE_PLAN_BYTES } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { MediaStorageService } from '../src/media/media-storage.service';

const NOW = new Date('2026-11-15T10:00:00.000Z');
const SUPER = 'adm_owner';

/** In-memory usage, holds, settings and roles for the storage rules. */
function harness(usedGib: number) {
	const holds = new Map<string, { id: string; userId: string; bytes: number; expiresAt: string }>();
	const audit: AuditLog[] = [];
	let settings: { othersMayUseOnDemand: boolean } | null = null;
	const used = { bytes: usedGib * GIB };
	const service = new MediaStorageService(
		{ usage: async () => ({ originals: used.bytes, versions: 0, files: 0, trash: 0 }) } as never,
		{
			reserve: async (hold: { id: string; userId: string; bytes: number; expiresAt: string }) =>
				void holds.set(hold.id, hold),
			release: async (id: string) => void holds.delete(id),
			reservedBytes: async (now: string, exceptId?: string) =>
				[...holds.values()]
					.filter((hold) => hold.expiresAt > now && hold.id !== exceptId)
					.reduce((sum, hold) => sum + hold.bytes, 0),
			findReservation: async (id: string) => holds.get(id) ?? null,
		} as never,
		{
			get: async () => settings,
			set: async (_key: string, value: { othersMayUseOnDemand: boolean }) => void (settings = value),
		} as never,
		{
			findByKey: async (key: string) => (key === 'administrator' ? { id: 'role_system_administrator' } : null),
		} as never,
		{
			findActive: async (userId: string, roleId: string) =>
				userId === SUPER && roleId === 'role_system_administrator' ? { userId, roleId } : null,
		} as never,
		{ append: async (entry: AuditLog) => (audit.unshift(entry), entry) } as never,
	);
	return { service, holds, audit, used, settings: () => settings };
}

const code = async (promise: Promise<unknown>) => {
	try {
		await promise;
	} catch (error) {
		return ((error as HttpException).getResponse() as { issues?: { code: string }[] }).issues?.[0]?.code;
	}
	throw new Error('expected a refusal');
};
const check = (bytes: number, extra: Record<string, unknown> = {}) => ({
	operation: 'upload' as const,
	bytes,
	approve: false,
	...extra,
});

describe('the storage box', () => {
	it('shows GiB like the bill, green, yellow from 60% and red from 85%', async () => {
		expect(await harness(100).service.summary('adm_1', NOW)).toMatchObject({
			usedBytes: 100 * GIB,
			planBytes: STORAGE_PLAN_BYTES,
			percent: 40,
			colour: 'green',
			onDemandBytes: 0,
			canChangeOnDemand: false,
		});
		expect((await harness(150).service.summary('adm_1', NOW)).colour).toBe('yellow');
		const red = await harness(260).service.summary(SUPER, NOW);
		expect(red).toMatchObject({
			colour: 'red',
			onDemandBytes: 10 * GIB,
			onDemandMonthlyUsd: 0.2,
			canChangeOnDemand: true,
		});
		expect(red.breakdown.map((row) => row.key)).toEqual(['originals', 'versions', 'files', 'trash', 'zips']);
	});
});

describe('the check before an operation', () => {
	it('goes within the plan and holds the bytes until the work releases them', async () => {
		const h = harness(100);
		const answer = await h.service.check('adm_1', check(2 * GIB), NOW);
		expect(answer).toMatchObject({ decision: 'go', afterBytes: 102 * GIB, onDemandBytes: 0 });
		expect(h.holds.get(answer.reservationId as string)).toMatchObject({ userId: 'adm_1', bytes: 2 * GIB });
		await h.service.release(answer.reservationId as string);
		expect(h.holds.size).toBe(0);
	});

	it('break-it: two admins uploading at 249 GB at once cannot both slip past the plan', async () => {
		const h = harness(249);
		const first = await h.service.check('adm_1', check(0.6 * GIB), NOW);
		const second = await h.service.check('adm_2', check(0.6 * GIB), NOW);
		expect(first.decision).toBe('go');
		expect(second).toMatchObject({ decision: 'refused', canApprove: false });
	});

	it('asks a super admin once past the plan; a yes goes, is recorded, and can let other admins too', async () => {
		const h = harness(248.9);
		expect((await h.service.check(SUPER, check(1.7 * GIB), NOW)).decision).toBe('ask');
		const yes = await h.service.check(SUPER, check(1.7 * GIB, { approve: true, alsoLetOthers: true }), NOW);
		expect(yes).toMatchObject({ decision: 'go', canApprove: true });
		expect(yes.onDemandBytes).toBeGreaterThan(0);
		expect(h.settings()).toEqual({ othersMayUseOnDemand: true });
		expect(h.audit.map((entry) => entry.action)).toEqual(['media.storage.settings', 'media.storage.on_demand']);
		// Other admins are now asked the same way, every time, instead of being stopped.
		expect((await h.service.check('adm_2', check(GIB), NOW)).decision).toBe('ask');
	});

	it('refuses other admins past the plan unless a super admin allowed it (B19)', async () => {
		const h = harness(249.5);
		expect(await h.service.check('adm_2', check(GIB, { approve: true }), NOW)).toMatchObject({
			decision: 'refused',
			reservationId: null,
		});
	});
});

describe('letting one upload start', () => {
	it('uses the person’s own hold, or checks again and holds under the upload’s id', async () => {
		const h = harness(10);
		const answer = await h.service.check('adm_1', check(GIB), NOW);
		await h.service.admit('adm_1', 100, answer.reservationId as string, 'res_med_1', NOW);
		expect(h.holds.has('res_med_1')).toBe(false);
		// Someone else's hold does not count for this person.
		await h.service.admit('adm_2', 100, answer.reservationId as string, 'res_med_2', NOW);
		expect(h.holds.get('res_med_2')).toMatchObject({ userId: 'adm_2', bytes: 100 });
	});

	it('stops an upload past the plan with the reason the Media page explains', async () => {
		const h = harness(249.99);
		expect(await code(h.service.admit(SUPER, GIB, undefined, 'res_x', NOW))).toBe('storage_needs_approval');
		expect(await code(h.service.admit('adm_2', GIB, undefined, 'res_y', NOW))).toBe('storage_refused');
		expect(h.holds.size).toBe(0);
	});
});

describe('settings and holds', () => {
	it('lets only a super admin change who may use on-demand storage', async () => {
		const h = harness(10);
		await expect(h.service.saveSettings('adm_2', { othersMayUseOnDemand: true })).rejects.toBeInstanceOf(
			ForbiddenException,
		);
		expect(await h.service.saveSettings(SUPER, { othersMayUseOnDemand: false })).toEqual({
			othersMayUseOnDemand: false,
		});
	});

	it('ends only your own hold', async () => {
		const h = harness(10);
		const answer = await h.service.check('adm_1', check(GIB), NOW);
		await expect(h.service.releaseOwn('adm_2', answer.reservationId as string)).rejects.toBeInstanceOf(
			NotFoundException,
		);
		await h.service.releaseOwn('adm_1', answer.reservationId as string);
		expect(h.holds.size).toBe(0);
	});
});
