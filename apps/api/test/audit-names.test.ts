import { describe, expect, it, vi } from 'vitest';

import { AuditLogsController } from '../src/admin/audit-logs.controller';
import { AuditLogsService } from '../src/admin/audit-logs.service';

/** Brief 26 AU1: the audit trail names its people, and lists everyone for the Who picker. */
const entry = (id: string, actorUserId: string | null) => ({
	id,
	actorUserId,
	targetUserId: null,
	audience: 'admin',
	action: 'payroll.payslip.edit',
	entityType: 'payrollRun',
	entityId: 'pay_1',
	severity: 'info',
	retentionTier: 'financial_security',
	diffs: [],
	metadata: {},
	requestId: null,
	ipHash: 'x',
	userAgentHash: 'y',
	createdAt: '2026-11-26T06:00:00.000Z',
});
const USERS = [
	{ id: 'adm_a', displayName: 'Mou Ghosh', username: 'mou', email: 'mou@saha-textile.test' },
	{ id: 'adm_b', username: 'rina', email: null },
	{ id: 'adm_c', username: null, email: 'c@saha-textile.test' },
	{ id: 'adm_d', username: null, email: null },
];

function build(admins = true, total = USERS.length) {
	const audit = {
		list: async () => ({
			items: [
				entry('1', 'adm_a'),
				entry('2', 'adm_b'),
				entry('3', 'adm_a'),
				entry('4', null),
				entry('5', 'adm_gone'),
			],
			total: 5,
			page: 1,
			pageSize: 50,
		}),
	};
	const findById = vi.fn(async (id: string) => USERS.find((u) => u.id === id) ?? null);
	const list = vi.fn(async ({ page }: { page: number }) => ({
		items: page === 1 ? USERS : [],
		meta: { total },
	}));
	return {
		service: new AuditLogsService(audit as never, admins ? ({ findById, list } as never) : null),
		findById,
		list,
	};
}

describe('names in the audit trail (AU1)', () => {
	it('names each person once a page: display name, else username, else email, else the id', async () => {
		const { service, findById } = build();
		const page = await service.list({ page: 1, pageSize: 50 });
		expect(page.items.map((i) => i.actorName)).toEqual(['Mou Ghosh', 'rina', 'Mou Ghosh', null, null]);
		expect(findById).toHaveBeenCalledTimes(3);
		expect(page.items[0]).not.toHaveProperty('ipHash');
	});

	it('lists everyone for the picker by name, page after page, and nothing without the users store', async () => {
		const { service } = build();
		expect(await service.people()).toEqual([
			{ id: 'adm_d', name: 'adm_d' },
			{ id: 'adm_c', name: 'c@saha-textile.test' },
			{ id: 'adm_a', name: 'Mou Ghosh' },
			{ id: 'adm_b', name: 'rina' },
		]);
		const many = build(true, 250);
		await many.service.people();
		expect(many.list).toHaveBeenCalledTimes(2);
		const none = build(false);
		expect(await none.service.people()).toEqual([]);
		expect((await none.service.list({ page: 1, pageSize: 50 })).items.map((i) => i.actorName)).toEqual([
			null,
			null,
			null,
			null,
			null,
		]);
	});

	it('hands the people route to the service', () => {
		const svc = { people: vi.fn(), list: vi.fn() };
		new AuditLogsController(svc as never).people();
		expect(svc.people).toHaveBeenCalled();
	});
});
