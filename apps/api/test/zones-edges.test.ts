import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PriceZone, ZoneRule } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { ZonesService } from '../src/orders-setup/zones.service';

const percent = { kind: 'percentOffBase', base: 'regularSelling', percent: 20 } as const;
/** Two quantity breaks at the same quantity: a mistake the builder names. */
const doubled = ZoneRule.parse({
	id: 'r_twice',
	scope: { tier: 'allProducts' },
	price: {
		kind: 'quantityBreaks',
		breaks: [
			{ minQuantity: 5, formula: percent },
			{ minQuantity: 5, formula: percent },
		],
	},
});
const fine = ZoneRule.parse({ id: 'r_fine', scope: { tier: 'allProducts' }, price: percent });
const zone = (over: Record<string, unknown> = {}) =>
	PriceZone.parse({
		id: 'zone_w',
		code: 'WHOLESALE',
		name: 'Wholesale',
		status: 'draft',
		rules: [fine],
		...over,
	});

function setup(stored: PriceZone | null, options: { inUse?: number; save?: () => Promise<never> } = {}) {
	const zones = {
		findById: async () => stored,
		save: options.save ?? vi.fn(async (row: PriceZone) => row),
		delete: vi.fn(async () => undefined),
	};
	const service = new ZonesService(zones as never, { countByZone: async () => options.inUse ?? 0 } as never);
	return { service, zones };
}
const write = (over: Record<string, unknown> = {}) =>
	({ code: 'WHOLESALE', name: 'Wholesale', description: '', rules: [fine], revision: 0, ...over }) as never;

describe('price zones: the remaining cases', () => {
	it('refuses a zone that does not exist', async () => {
		await expect(setup(null).service.get('zone_x')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('needs the revision that was edited, and keeps a live zone free of mistakes', async () => {
		await expect(
			setup(zone()).service.update('zone_w', write({ revision: undefined }), null),
		).rejects.toBeInstanceOf(BadRequestException);
		await expect(
			setup(zone({ status: 'live' })).service.update('zone_w', write({ rules: [doubled] }), null, true),
		).rejects.toMatchObject({ response: { issues: [{ code: 'zone_rule_problems' }] } });
		const draft = await setup(zone()).service.update('zone_w', write({ rules: [doubled] }), 'adm_1', true);
		expect(draft.rules).toHaveLength(1);
	});

	it('refuses a status change for RETAIL, and takes a zone back to draft without checking its rules', async () => {
		await expect(
			setup(zone({ system: true })).service.setStatus('zone_w', 'draft', 0, null),
		).rejects.toBeInstanceOf(ConflictException);
		const { service, zones } = setup(zone({ status: 'live', rules: [doubled] }));
		await service.setStatus('zone_w', 'draft', 0, 'adm_1');
		expect(zones.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }), 0);
	});

	it('deletes a zone no business uses, and refuses one still in use', async () => {
		await expect(setup(zone(), { inUse: 2 }).service.remove('zone_w', null)).rejects.toMatchObject({
			response: { issues: [{ code: 'zone_in_use' }] },
		});
		const { service, zones } = setup(zone());
		await service.remove('zone_w', 'adm_1');
		expect(zones.delete).toHaveBeenCalledWith('zone_w');
	});

	it('says plainly when the code is taken, and lets other save failures through', async () => {
		const taken = setup(null, {
			save: async () => Promise.reject(Object.assign(new Error('dup'), { code: 11000 })),
		});
		await expect(taken.service.create(write(), null)).rejects.toMatchObject({
			response: { issues: [{ code: 'zone_code_taken' }] },
		});
		const broken = setup(null, { save: async () => Promise.reject(new Error('database down')) });
		await expect(broken.service.create(write(), null)).rejects.toThrow('database down');
	});
});
