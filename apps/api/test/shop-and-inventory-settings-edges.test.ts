import { InventorySettings, ShopDetails, gstinProblem } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { InventorySettingsService } from '../src/purchasing/inventory-settings.service';
import { ShopDetailsService } from '../src/purchasing/shop-details.service';

/** A GSTIN with its right check character. */
const valid = (gstin: string) => gstin.slice(0, 14) + (gstinProblem(gstin)?.expected ?? gstin.slice(14));
const WB = valid('19AAPFS4821K1ZM');
const MH = valid('27AAPFS4821K1ZM');
const wrongDigit = (gstin: string) => gstin.slice(0, 14) + (gstin[14] === 'A' ? 'B' : 'A');

describe('inventory settings, edges', () => {
	function build(before: Record<string, unknown> = {}, roles: Record<string, unknown> = {}) {
		const settings = InventorySettings.parse(before);
		const repository = { get: async () => settings, save: vi.fn(async () => undefined) };
		const support = {
			record: vi.fn(async () => undefined),
			nameOf: async () => 'Rina',
			findRole: async (id: string) => roles[id] ?? null,
			roleLabels: async () => ({}),
		};
		return { service: new InventorySettingsService(repository as never, support as never), settings, support };
	}
	const write = (settings: InventorySettings, over: Record<string, unknown> = {}) =>
		({ ...settings, ...over }) as never;

	it('refuses a step role that no longer exists', async () => {
		const { service, settings } = build();
		await expect(
			service.update(
				write(settings, { stepRules: { ...settings.stepRules, postRoleId: 'role_gone' } }),
				'adm_1',
				{
					superAdmin: true,
				},
			),
		).rejects.toMatchObject({
			response: { message: 'role_missing', issues: [{ path: ['role_missing', 'stepRules.postRoleId'] }] },
		});
	});

	it('refuses a GSTIN with the wrong check digit, naming the right one, or one that is not a GSTIN', async () => {
		const { service, settings } = build();
		const business = (gstin: string) => ({ ...settings.business, gstin });
		await expect(
			service.update(write(settings, { business: business(wrongDigit(WB)) }), null),
		).rejects.toMatchObject({
			response: { issues: [{ message: `The GSTIN should end in ${WB[14]}.` }] },
		});
		await expect(
			service.update(write(settings, { business: business('NOT-A-GSTIN') }), null),
		).rejects.toMatchObject({
			response: { issues: [{ message: 'That is not a GSTIN.' }] },
		});
	});

	it('stores a typed GSTIN upper-case and says the shop’s details changed', async () => {
		const { service, settings, support } = build();
		const next = await service.update(
			write(settings, { business: { ...settings.business, gstin: WB.toLowerCase() } }),
			'adm_1',
		);
		expect(next.business.gstin).toBe(WB);
		expect(support.record).toHaveBeenCalledWith(
			expect.objectContaining({ text: "Rina changed the shop's name, GSTIN or address on documents." }),
		);
	});

	it('says which different-person rules went on and off, and names a role that is gone', async () => {
		const { service, settings, support } = build(
			{ stepRules: { checkByDifferentPerson: false, postByDifferentPerson: true, checkRoleId: 'role_gone' } },
			{},
		);
		await service.update(
			write(settings, {
				stepRules: {
					...settings.stepRules,
					checkByDifferentPerson: true,
					postByDifferentPerson: false,
					checkRoleId: null,
				},
			}),
			'adm_1',
			{ superAdmin: true },
		);
		expect(support.record).toHaveBeenCalledWith(
			expect.objectContaining({
				text:
					'Rina changed "check goods needs a different person" on; "post to stock needs a different person" off; ' +
					'who may check goods from the role that no longer exists to anyone with the permission.',
			}),
		);
	});

	it('writes no sentence when nothing changed', async () => {
		const { service, settings, support } = build();
		await service.update(write(settings), 'adm_1');
		expect(support.record).not.toHaveBeenCalled();
	});
});

describe('shop details, edges', () => {
	function build(
		parts: {
			before?: Record<string, unknown>;
			home?: string;
			suppliers?: unknown[];
			updatedBy?: string | null;
		} = {},
	) {
		const before = ShopDetails.parse({
			legalName: 'Saha Textile',
			gstin: WB,
			address: '14 Hazra Road',
			...parts.before,
		});
		const support = {
			shopDetails: async () => before,
			homeState: async () => parts.home ?? '19',
			nameOf: async () => 'Rina',
			record: vi.fn(async () => undefined),
			guardStale: async <T>(work: () => Promise<T>) => work(),
		};
		const suppliers = {
			list: async (query: { page: number }) => ({ items: query.page === 1 ? (parts.suppliers ?? []) : [] }),
			save: vi.fn(async () => undefined),
		};
		const service = new ShopDetailsService(
			{ save: vi.fn(async () => undefined) } as never,
			suppliers as never,
			{ brandFacts: async () => ({ shopName: 'Saha Textile', logoUrl: null }) } as never,
			support as never,
		);
		return { service, support, suppliers };
	}

	it('names a home State the GST list does not know by its code', async () => {
		const impact = await build({ home: '00' }).service.impact(WB);
		expect(impact.stateFrom).toEqual({ code: '00', name: '00' });
		expect(impact.stateTo).toEqual({ code: '19', name: 'West Bengal' });
	});

	it('refuses a GSTIN that is not a GSTIN', async () => {
		await expect(
			build().service.update(
				{ legalName: 'Saha Textile', gstin: 'NOT-A-GSTIN', expectedUpdatedAt: null } as never,
				'adm_1',
				{
					canEdit: true,
				},
			),
		).rejects.toMatchObject({
			response: { message: 'gstin_invalid', issues: [{ message: 'That is not a GSTIN.' }] },
		});
		await expect(
			build().service.update(
				{ legalName: 'Saha Textile', gstin: wrongDigit(WB), expectedUpdatedAt: null } as never,
				'adm_1',
				{
					canEdit: true,
				},
			),
		).rejects.toMatchObject({ response: { message: 'gstin_check_digit' } });
	});

	it('says a cleared field went empty, the State is unchanged, and writes nothing when nothing changed', async () => {
		const { service, support } = build();
		await service.update(
			{ legalName: 'Saha Textile', gstin: WB, address: '', expectedUpdatedAt: null } as never,
			'adm_1',
			{
				canEdit: true,
			},
		);
		expect(support.record).toHaveBeenCalledWith(
			expect.objectContaining({ text: 'Rina changed the shop\'s address from "14 Hazra Road" to empty.' }),
		);
		const same = build();
		await same.service.update(
			{ legalName: 'Saha Textile', gstin: WB, address: '14 Hazra Road', expectedUpdatedAt: null } as never,
			'adm_1',
			{ canEdit: true },
		);
		expect(same.support.record).not.toHaveBeenCalled();
		const regstin = build({ before: { gstin: null } });
		await regstin.service.update(
			{ legalName: 'Saha Textile', gstin: WB, address: '14 Hazra Road' } as never,
			null,
			{
				canEdit: true,
			},
		);
		expect(regstin.support.record).toHaveBeenCalledWith(
			expect.objectContaining({
				text: 'Rina changed the shop\'s GSTIN from empty to "' + WB + '". State unchanged (West Bengal).',
			}),
		);
	});

	it('reads every page of suppliers when the State moves', async () => {
		const many = Array.from({ length: 200 }, (_, at) => ({
			id: `sup_${at}`,
			legalName: `Weaver ${at}`,
			kind: 'regular',
			stateCode: at === 0 ? '27' : '19',
		}));
		const impact = await build({ suppliers: many }).service.impact(MH);
		expect(impact.toIntraState).toEqual([{ id: 'sup_0', name: 'Weaver 0' }]);
		expect(impact.toInterState).toHaveLength(199);
	});

	it('moves the home State and retaxes no supplier when none changes', async () => {
		const { service, support, suppliers } = build({
			suppliers: [{ id: 'sup_1', legalName: 'Local', kind: 'unregistered', stateCode: '19' }],
		});
		await service.update({ legalName: 'Saha Textile', gstin: MH, address: '14 Hazra Road' } as never, 'adm_1', {
			canEdit: true,
		});
		expect(support.record).toHaveBeenCalledTimes(1);
		expect(support.record).toHaveBeenCalledWith(
			expect.objectContaining({ text: expect.stringContaining('State West Bengal → Maharashtra.') }),
		);
		expect(suppliers.save).not.toHaveBeenCalled();
	});
});
