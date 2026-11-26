import { describe, expect, it, vi } from 'vitest';

import { RolesController, RolesService } from '../src/ledger/roles';

/** Roles in this company's books (accounts templates AT4). */

const at = '2026-11-01T00:00:00.000Z';
const ledger = (id: string, systemKey: string | null, roles: string[] = [], active = true) => ({
	id,
	systemKey,
	roles,
	name: `Ledger ${id}`,
	groupId: 'g',
	nature: 'asset',
	handPosting: true,
	active,
	createdAt: at,
	updatedAt: at,
	updatedBy: null,
});

function setup(options: { superAdmin?: boolean; saveFails?: string } = {}) {
	const chart = {
		groups: [{ id: 'grp_cash', systemKey: 'cash_in_hand', roles: [], name: 'Cash in hand' }],
		ledgers: [
			ledger('led_cash', 'cash'),
			ledger('led_hand', null, ['customer_advances']),
			ledger('led_adv', 'customer_advances'),
			ledger('led_old', 'gateway_clearing', [], false),
		],
	};
	const saved: { id: string; roles: string[] }[] = [];
	const audit: Record<string, unknown>[] = [];
	const service = new RolesService(
		{ chart: async () => chart, isSuperAdmin: async () => options.superAdmin ?? true } as never,
		{
			installedCharts: async () => [{ label: 'CH-COMMON v2', keys: new Set(['cash', 'customer_advances']) }],
		} as never,
		{
			saveLedger: vi.fn(async (l: { id: string; roles: string[] }) => {
				if (options.saveFails) throw new Error(options.saveFails);
				saved.push({ id: l.id, roles: l.roles });
			}),
		} as never,
		{ append: async (entry: Record<string, unknown>) => void audit.push(entry) } as never,
	);
	return { service, saved, audit };
}

const owner = { userId: 'adm_owner' } as never;

describe('roles in the books (AT4)', () => {
	it('lists who plays each role, the template that set it, and what is missing or doubled', async () => {
		const rows = await setup().service.rows();
		const row = (key: string) => rows.find((r) => r.key === key);
		expect(row('cash')).toMatchObject({
			target: 'ledger',
			holderId: 'led_cash',
			fromTemplate: 'CH-COMMON v2',
			problem: null,
		});
		expect(row('customer_advances')).toMatchObject({ holderId: null, problem: 'ambiguous' });
		expect(row('gateway_clearing')).toMatchObject({
			holderId: null,
			holderName: null,
			fromTemplate: null,
			problem: 'missing',
		});
		expect(row('cash_in_hand')).toMatchObject({ target: 'group', holderName: 'Cash in hand', fromTemplate: null });
		expect(row('cash')?.usedBy).toContain('paymentVoucher');
	});

	it('lets the super admin point a ledger role at another ledger, the old ones stop playing it', async () => {
		const { service, saved, audit } = setup();
		const routes = new RolesController(service);
		await routes.point('customer_advances', { ledgerId: 'led_cash' }, owner);
		expect(saved).toEqual([
			{ id: 'led_hand', roles: ['none'] },
			{ id: 'led_adv', roles: ['none'] },
			{ id: 'led_cash', roles: ['cash', 'customer_advances'] },
		]);
		expect(audit[0]).toMatchObject({
			action: 'accounts.role.point',
			diffs: [
				{ field: 'customer_advances', before: 'Ledger led_hand, Ledger led_adv', after: 'Ledger led_cash' },
			],
		});
		const fresh = setup();
		await fresh.service.point('upi_card_clearing', { ledgerId: 'led_cash' }, undefined);
		expect(fresh.audit[0]).toMatchObject({ actorUserId: null, diffs: [{ before: null }] });
		expect((await routes.rows()).length).toBeGreaterThan(10);
	});

	it('refuses anyone else, a group role or unknown role, a ledger gone or off, and a ledger changed meanwhile', async () => {
		const words = async (work: Promise<unknown>) =>
			((await work.catch((e: unknown) => e)) as { response?: { issues?: { message: string }[] } }).response
				?.issues?.[0]?.message;
		expect(await words(setup({ superAdmin: false }).service.point('cash', { ledgerId: 'led_cash' }, owner))).toBe(
			'roles_super_admin_only',
		);
		expect(await words(setup().service.point('cash_in_hand', { ledgerId: 'led_cash' }, owner))).toBe(
			'role_unknown',
		);
		expect(await words(setup().service.point('nothing', { ledgerId: 'led_cash' }, owner))).toBe('role_unknown');
		expect(await words(setup().service.point('cash', { ledgerId: 'led_old' }, owner))).toBe('role_ledger_unknown');
		expect(
			await words(setup({ saveFails: 'ledger_changed' }).service.point('cash', { ledgerId: 'led_adv' }, owner)),
		).toBe('ledger_changed');
		await expect(
			setup({ saveFails: 'db_down' }).service.point('cash', { ledgerId: 'led_adv' }, owner),
		).rejects.toThrow('db_down');
	});
});
