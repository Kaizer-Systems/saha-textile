import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Coupon } from '@saha-textile/contracts';
import { DuplicateCouponCodeError } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { CouponsService } from '../src/orders-setup/coupons.service';

const write = { code: 'TEN', title: 'Ten off', kind: 'percentOff', value: 10 } as never;

function setup(options: { save?: (coupon: Coupon) => Promise<Coupon>; used?: string[] } = {}) {
	const stored = new Map<string, Coupon>();
	const repo = {
		list: vi.fn(async () => ({ items: [], total: 0, counts: {} })),
		findById: async (id: string) => stored.get(id) ?? null,
		save: options.save ?? (async (coupon: Coupon) => (stored.set(coupon.id, coupon), coupon)),
		setEnabled: vi.fn(async (ids: string[]) => ids.filter((id) => stored.has(id))),
		usedOnOrders: async (id: string) => (options.used ?? []).includes(id),
		delete: vi.fn(async (ids: string[]) => ids),
	};
	const audit = { append: vi.fn(async () => undefined) };
	return { svc: new CouponsService(repo as never, audit as never), repo, stored, audit };
}

describe('coupons', () => {
	it('lists through the repository, and refuses an unknown coupon', async () => {
		const { svc, repo } = setup();
		await svc.list({ filter: 'all', page: 1, pageSize: 20 } as never);
		expect(repo.list).toHaveBeenCalled();
		await expect(svc.get('cpn_none')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('creates and updates a coupon, needing the revision that was edited', async () => {
		const { svc } = setup();
		const made = await svc.create(write, 'adm');
		expect(made).toMatchObject({ code: 'TEN', usedCount: 0, updatedBy: 'adm' });
		await expect(svc.update(made.id, write, 'adm')).rejects.toBeInstanceOf(BadRequestException);
		expect(
			(await svc.update(made.id, { ...(write as object), title: 'Renamed', revision: 0 } as never, null)).title,
		).toBe('Renamed');
	});

	it('says plainly when the code is taken, and lets other failures through', async () => {
		const taken = setup({
			save: async () => {
				throw new DuplicateCouponCodeError('TEN');
			},
		});
		await expect(taken.svc.create(write, 'adm')).rejects.toBeInstanceOf(ConflictException);
		const broken = setup({
			save: async () => {
				throw new Error('database down');
			},
		});
		await expect(broken.svc.create(write, 'adm')).rejects.toThrow('database down');
	});

	it('turns one coupon on or off, by the system when nobody is signed in', async () => {
		const { svc, repo } = setup();
		const made = await svc.create(write, 'adm');
		await svc.setEnabled(made.id, false, null);
		await svc.setEnabled(made.id, true, 'adm');
		expect(repo.setEnabled.mock.calls).toEqual([
			[[made.id], false, 'system'],
			[[made.id], true, 'adm'],
		]);
	});

	it('deletes unused coupons in bulk, turning used ones off instead, and refusing unknown ones', async () => {
		const first = setup();
		const a = await first.svc.create(write, 'adm');
		const b = await first.svc.create({ ...(write as object), code: 'TWENTY' } as never, 'adm');
		const { svc, repo } = setup({ used: [b.id] });
		await svc.create(write, 'adm');
		const usedRepo = setup({ used: [b.id] });
		usedRepo.stored.set(a.id, a);
		usedRepo.stored.set(b.id, b);
		const result = await usedRepo.svc.bulk(
			{ action: 'delete', ids: [a.id, b.id, 'cpn_none', a.id] } as never,
			null,
		);
		expect(result.done).toEqual([a.id]);
		expect(result.refused).toEqual([
			{ id: b.id, code: 'TWENTY', reason: 'used_on_orders' },
			{ id: 'cpn_none', code: '', reason: 'not_found' },
		]);
		expect(usedRepo.repo.setEnabled).toHaveBeenCalledWith([b.id], false, 'system');
		expect((await svc.bulk({ action: 'delete', ids: ['cpn_none'] } as never, 'adm')).done).toEqual([]);
		expect(repo.setEnabled).not.toHaveBeenCalled();
	});

	it('turns coupons on or off in bulk, refusing the ones it could not find', async () => {
		const { svc } = setup();
		const made = await svc.create(write, 'adm');
		expect(await svc.bulk({ action: 'turnOff', ids: [made.id, 'cpn_none'] } as never, 'adm')).toEqual({
			done: [made.id],
			refused: [{ id: 'cpn_none', code: '', reason: 'not_found' }],
		});
		expect((await svc.bulk({ action: 'turnOn', ids: [made.id] } as never, null)).done).toEqual([made.id]);
	});
});
