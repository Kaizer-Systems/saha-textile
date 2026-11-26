import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PayrollRulesVersion, SalaryTemplate, SalaryTemplateWrite } from '@saha-textile/contracts';
import { PAYROLL_RULES_2026, PAYROLL_SCHEMES_2026 } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { BUILT_IN_PAYROLL_RULES, PayrollRulesService, rulesOf } from '../src/payroll/payroll-rules.service';
import { PayrollSetupController } from '../src/payroll/payroll-setup.controller';
import { SalaryTemplatesService } from '../src/payroll/salary-templates.service';

/** Payroll rules (accounts brief S1), structure templates (S4) and the setup routes. */

const at = '2026-12-01T06:00:00.000Z';
const now = new Date(at);
const refusal = (code: string) => ({ response: { message: code } });
const ca = { userId: 'adm_ca', permissions: ['accounts.lock'] } as never;

/** A later version: ESI's wage limit raised to ₹25,000 from 1 October 2026. */
const version = (from: string, over: Partial<PayrollRulesVersion> = {}): PayrollRulesVersion => ({
	...BUILT_IN_PAYROLL_RULES,
	from,
	esiGrossLimitPaise: 25_000_00,
	id: `prs_${from}`,
	builtIn: false,
	createdBy: 'adm_ca',
	createdAt: at,
	...over,
});
const run = (month: string, status: string) => ({ month, status }) as never;

function rulesBuild(options: { stored?: PayrollRulesVersion[]; runs?: unknown[]; insertFails?: unknown } = {}) {
	const store = {
		list: async () => [...(options.stored ?? [])],
		insert: vi.fn(async () => {
			if (options.insertFails !== undefined) throw options.insertFails;
		}),
	};
	const audit = { append: vi.fn(async () => undefined) };
	const service = new PayrollRulesService(
		store as never,
		{ list: async () => options.runs ?? [] } as never,
		audit as never,
	);
	return { service, store, audit };
}

describe('payroll rule versions (S1)', () => {
	it('starts from the built-in 2026 rules and schemes, and splits a version into pay rules and schemes', () => {
		expect(BUILT_IN_PAYROLL_RULES).toMatchObject({
			id: 'prs_built_in',
			builtIn: true,
			from: '2026-04-01',
			note: '',
		});
		const split = rulesOf(BUILT_IN_PAYROLL_RULES);
		expect(split.from).toBe('2026-04-01');
		expect(split.pay).toEqual(PAYROLL_RULES_2026);
		expect(split.schemes).toEqual(PAYROLL_SCHEMES_2026);
	});

	it('lists every version oldest first with the built-in one, and uses the one in force on a month’s last day', async () => {
		const { service } = rulesBuild({ stored: [version('2027-04-01'), version('2026-10-01')] });
		expect((await service.list()).map((v) => v.id)).toEqual(['prs_built_in', 'prs_2026-10-01', 'prs_2027-04-01']);
		expect((await service.forMonth('2026-09')).from).toBe('2026-04-01');
		expect((await service.forMonth('2026-10')).pay.esiGrossLimitPaise).toBe(25_000_00);
		expect((await service.forMonth('2027-05')).from).toBe('2027-04-01');
		// Before the built-in version began: the built-in rules all the same.
		expect((await service.forMonth('2025-11')).from).toBe('2026-04-01');
	});

	it('adds a version after the last month already approved, logging who added it', async () => {
		const { service, store, audit } = rulesBuild({ runs: [run('2026-10', 'posted'), run('2026-11', 'draft')] });
		const { id: _id, builtIn: _b, createdBy: _c, createdAt: _a, ...write } = version('2026-11-01');
		const added = await service.add(write, ca, now);
		expect(added).toMatchObject({ id: 'prs_2026-11-01', builtIn: false, createdBy: 'adm_ca', createdAt: at });
		expect(store.insert).toHaveBeenCalledWith(added);
		expect(audit.append).toHaveBeenCalledWith(
			expect.objectContaining({
				actorUserId: 'adm_ca',
				action: 'payroll.rules.add',
				entityType: 'payrollRules',
				entityId: 'prs_2026-11-01',
				retentionTier: 'financial_security',
				metadata: { from: '2026-11-01' },
				createdAt: at,
			}),
		);
		expect((await service.add(write, undefined)).createdBy).toBeNull();
	});

	it('refuses a version starting in or before an approved month, a day already taken, and passes on other failures', async () => {
		const { id: _id, builtIn: _b, createdBy: _c, createdAt: _a, ...write } = version('2026-10-31');
		const before = rulesBuild({ runs: [run('2026-10', 'approved')] }).service.add(write, ca);
		await expect(before).rejects.toBeInstanceOf(BadRequestException);
		await expect(before).rejects.toMatchObject(refusal('payroll_rules_before_approved'));
		const taken = rulesBuild({ insertFails: new Error('payroll_rules_from_taken') }).service.add(write, ca);
		await expect(taken).rejects.toBeInstanceOf(ConflictException);
		await expect(taken).rejects.toMatchObject(refusal('payroll_rules_from_taken'));
		const diskFull = new Error('disk full');
		await expect(rulesBuild({ insertFails: diskFull }).service.add(write, ca)).rejects.toBe(diskFull);
		const odd = { code: 'not an error' };
		await expect(rulesBuild({ insertFails: odd }).service.add(write, ca)).rejects.toBe(odd);
	});
});

describe('salary structure templates (S4)', () => {
	const components = [
		{ head: 'basic', how: 'percent', value: 40 },
		{ head: 'da', how: 'percent', value: 5 },
		{ head: 'hra', how: 'percent', value: 20 },
		{ head: 'conveyance', how: 'fixed', value: 1_600 },
		{ head: 'special', how: 'rest', value: 0 },
	] as SalaryTemplateWrite['components'];
	const template = (over: Partial<SalaryTemplate> = {}): SalaryTemplate => ({
		name: 'Shop staff',
		examplePayINR: 20_000,
		components,
		id: 'sst_1',
		createdAt: at,
		updatedAt: at,
		version: 2,
		...over,
	});
	const templatesBuild = (options: { saveFails?: unknown } = {}) => {
		const rows = new Map([['sst_1', template()]]);
		const store = {
			list: async () => [...rows.values()],
			get: async (id: string) => rows.get(id) ?? null,
			insert: vi.fn(async (t: SalaryTemplate) => void rows.set(t.id, t)),
			save: vi.fn(async (t: SalaryTemplate, expectedVersion: number) => {
				if (options.saveFails !== undefined) throw options.saveFails;
				if (rows.get(t.id)?.version !== expectedVersion) throw new Error('salary_template_changed');
				return { ...t, version: expectedVersion + 1 };
			}),
		};
		return { service: new SalaryTemplatesService(store as never, { forMonth: vi.fn() } as never), store };
	};

	it('previews ₹20,000 on the template: the fixed amount typed in rupees, the rest taking what is left', () => {
		expect(templatesBuild().service.preview(components, 20_000)).toEqual({
			structure: { basic: 8_000, da: 1_000, hra: 4_000, conveyance: 1_600, special: 5_400, other: 0 },
			lines: [
				{ head: 'basic', inr: 8_000, treatment: 'yes' },
				{ head: 'da', inr: 1_000, treatment: 'yes' },
				{ head: 'hra', inr: 4_000, treatment: 'excluded' },
				{ head: 'conveyance', inr: 1_600, treatment: 'over_half' },
				{ head: 'special', inr: 5_400, treatment: 'over_half' },
			],
			totalINR: 20_000,
			basicSharePct: 45,
			shortfallINR: 1_000,
		});
		// Nothing to pay and nothing fixed: no basic share either.
		const percentsOnly = components.filter((c) => c.how !== 'fixed');
		expect(templatesBuild().service.preview(percentsOnly, 0)).toMatchObject({ totalINR: 0, basicSharePct: 0 });
	});

	it('lists, adds and changes templates over the version read', async () => {
		const { service, store } = templatesBuild();
		expect((await service.list()).map((t) => t.id)).toEqual(['sst_1']);
		const { id: _id, createdAt: _c, updatedAt: _u, version: _v, ...write } = template();
		const added = await service.create({ ...write, name: 'Office staff' }, now);
		expect(added).toMatchObject({ name: 'Office staff', createdAt: at, updatedAt: at, version: 0 });
		expect(added.id).toMatch(/^sst_/);
		expect(store.insert).toHaveBeenCalledWith(added);
		expect((await service.create(write)).name).toBe('Shop staff');
		expect(await service.update('sst_1', { ...write, name: 'Counter staff', version: 2 }, now)).toMatchObject({
			name: 'Counter staff',
			updatedAt: at,
			version: 3,
		});
		const stale = service.update('sst_1', { ...write, version: 1 });
		await expect(stale).rejects.toBeInstanceOf(ConflictException);
		await expect(stale).rejects.toMatchObject(refusal('salary_template_changed'));
		const missing = service.update('sst_9', { ...write, version: 0 });
		await expect(missing).rejects.toBeInstanceOf(NotFoundException);
		await expect(missing).rejects.toMatchObject(refusal('salary_template_not_found'));
	});

	it('passes on any other failure to save a change', async () => {
		const { id: _id, createdAt: _c, updatedAt: _u, version: _v, ...write } = template();
		const diskFull = new Error('disk full');
		await expect(
			templatesBuild({ saveFails: diskFull }).service.update('sst_1', { ...write, version: 2 }),
		).rejects.toBe(diskFull);
		const odd = { code: 'not an error' };
		await expect(templatesBuild({ saveFails: odd }).service.update('sst_1', { ...write, version: 2 })).rejects.toBe(
			odd,
		);
	});
});

describe('the payroll setup routes', () => {
	it('hand each call to its service with its permission', () => {
		const proxyOf = (label: string) =>
			new Proxy(
				{},
				{
					get:
						(_t, name: string) =>
						(...args: unknown[]) => [label, name, ...args],
				},
			);
		const c = new PayrollSetupController(
			proxyOf('rules') as never,
			proxyOf('templates') as never,
			proxyOf('returns') as never,
			proxyOf('advances') as never,
		);
		const rules = { from: '2026-11-01' } as never;
		const preview = { components: [], payINR: 20_000, ctc: false };
		const structure = { name: 'Shop staff' } as never;
		const change = { name: 'Shop staff', version: 1 } as never;
		const filing = { filedOn: '2026-12-14', reference: 'TRRN-1', stateCode: null };
		const give = { amountINR: 5_000 } as never;
		expect([
			c.listRules(),
			c.addRules(rules, ca),
			c.addRules(rules),
			c.schemes('2026-11'),
			c.structures(),
			c.preview(preview),
			c.createStructure(structure),
			c.updateStructure('sst_1', change),
			c.payslip('2026-11', 'emp_1'),
			c.statutory(),
			c.statutoryFile('pf', '2026-11', null),
			c.markFiled('pf', '2026-11', filing, ca),
			c.markFiled('pf', '2026-11', filing),
			c.listAdvances(),
			c.advance('emp_1'),
			c.giveAdvance('emp_1', give, ca),
			c.giveAdvance('emp_1', give),
		]).toEqual([
			['rules', 'list'],
			['rules', 'add', rules, ca],
			['rules', 'add', rules, undefined],
			['returns', 'schemes', '2026-11'],
			['templates', 'list'],
			['templates', 'preview', [], 20_000],
			['templates', 'create', structure],
			['templates', 'update', 'sst_1', change],
			['returns', 'payslip', '2026-11', 'emp_1'],
			['returns', 'returns'],
			['returns', 'file', 'pf', '2026-11', null],
			['returns', 'markFiled', 'pf', '2026-11', filing, ca],
			['returns', 'markFiled', 'pf', '2026-11', filing, undefined],
			['advances', 'list'],
			['advances', 'schedule', 'emp_1'],
			['advances', 'give', 'emp_1', give, ca],
			['advances', 'give', 'emp_1', give, undefined],
		]);
		const routes = [
			'listRules',
			'addRules',
			'schemes',
			'structures',
			'preview',
			'createStructure',
			'updateStructure',
			'payslip',
			'statutory',
			'statutoryFile',
			'markFiled',
			'listAdvances',
			'advance',
			'giveAdvance',
		] as const;
		const perm = (m: (typeof routes)[number]) =>
			new Reflector().get(PERMISSIONS_KEY, PayrollSetupController.prototype[m]);
		expect(routes.map(perm)).toEqual([
			['accounts.index'],
			['accounts.lock'],
			['accounts.index'],
			['accounts.index'],
			['accounts.index'],
			['accounts.edit'],
			['accounts.edit'],
			['accounts.index'],
			['accounts.index'],
			['accounts.index'],
			['accounts.post'],
			['accounts.index'],
			['accounts.index'],
			['accounts.post'],
		]);
	});
});
