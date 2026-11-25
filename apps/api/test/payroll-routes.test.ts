import { randomBytes } from 'node:crypto';

import { Reflector } from '@nestjs/core';
import {
	MongoAttendanceRepository,
	MongoEmployeeRepository,
	MongoPayrollAdvanceRepository,
	MongoPayrollRulesRepository,
	MongoPayrollRunRepository,
	MongoSalaryTemplateRepository,
	MongoStatutoryFilingRepository,
} from '@saha-textile/adapters-db-mongo';
import { describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { APP_CONFIG, loadConfig } from '../src/config/app-config';
import { PersistenceModule } from '../src/infra/persistence.module';
import {
	ATTENDANCE_REPOSITORY,
	EMPLOYEE_REPOSITORY,
	PAYROLL_ADVANCE_REPOSITORY,
	PAYROLL_RULES_REPOSITORY,
	PAYROLL_RUN_REPOSITORY,
	SALARY_TEMPLATE_REPOSITORY,
	STATUTORY_FILING_REPOSITORY,
} from '../src/infra/tokens';
import { DocumentsModule } from '../src/documents/documents.module';
import { LedgerModule } from '../src/ledger/ledger.module';
import { OrdersSetupModule } from '../src/orders-setup/orders-setup.module';
import { PayrollAdvancesService } from '../src/payroll/payroll-advances.service';
import { PayrollReturnsService } from '../src/payroll/payroll-returns.service';
import { PayrollRulesService } from '../src/payroll/payroll-rules.service';
import { PayrollSetupController } from '../src/payroll/payroll-setup.controller';
import { PayrollController } from '../src/payroll/payroll.controller';
import { PayrollModule, employeeStoreFor } from '../src/payroll/payroll.module';
import { PayrollService } from '../src/payroll/payroll.service';
import { SalaryTemplatesService } from '../src/payroll/salary-templates.service';

/** Payroll's routes, its module and the key that seals employees' personal numbers (accounts brief S, D29). */

const owner = { userId: 'adm_ca', permissions: ['accounts.lock'] } as never;
const baseEnv = { JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32) };
const load = (overrides: Record<string, string | undefined> = {}) =>
	loadConfig({ ...baseEnv, ...overrides } as NodeJS.ProcessEnv);

describe('the payroll routes', () => {
	it('hand each call to the service: reading needs accounts.index, changing accounts.edit, a step accounts.post', () => {
		const payroll = new Proxy(
			{},
			{
				get:
					(_t, name: string) =>
					(...args: unknown[]) => [name, ...args],
			},
		);
		const c = new PayrollController(payroll as never);
		const employee = { name: 'Meera' } as never;
		const edit = { name: 'Meera', version: 1 } as never;
		const attendance = { rows: [], lock: true, version: 0 };
		const step = { to: 'approved', version: 0, bankLedgerId: null, paidOn: null } as const;
		expect([
			c.employees(owner),
			c.employees(),
			c.createEmployee(employee),
			c.updateEmployee('emp_1', edit),
			c.attendance('2026-11'),
			c.saveAttendance('2026-11', attendance, owner),
			c.saveAttendance('2026-11', attendance),
			c.runs(),
			c.run('2026-11'),
			c.prepare('2026-11'),
			c.step('2026-11', step, owner),
			c.step('2026-11', step),
		]).toEqual([
			['listEmployees', owner],
			['listEmployees', undefined],
			['createEmployee', employee],
			['updateEmployee', 'emp_1', edit],
			['getAttendance', '2026-11'],
			['saveAttendance', '2026-11', attendance, owner],
			['saveAttendance', '2026-11', attendance, undefined],
			['listRuns'],
			['getRun', '2026-11'],
			['prepare', '2026-11'],
			['step', '2026-11', step, owner],
			['step', '2026-11', step, undefined],
		]);
		const routes = [
			'employees',
			'createEmployee',
			'updateEmployee',
			'attendance',
			'saveAttendance',
			'runs',
			'run',
			'prepare',
			'step',
		] as const;
		const perm = (m: (typeof routes)[number]) =>
			new Reflector().get(PERMISSIONS_KEY, PayrollController.prototype[m]);
		expect(routes.map(perm)).toEqual([
			['accounts.index'],
			['accounts.edit'],
			['accounts.edit'],
			['accounts.index'],
			['accounts.edit'],
			['accounts.index'],
			['accounts.index'],
			['accounts.edit'],
			['accounts.post'],
		]);
	});
});

describe('the payroll module', () => {
	it('builds the employees’ store with the sealing key when it is set, and without it when it isn’t', () => {
		const key = randomBytes(32);
		const sealed = employeeStoreFor({ payroll: { piiKey: key.toString('base64') } });
		expect(sealed).toBeInstanceOf(MongoEmployeeRepository);
		expect((sealed as unknown as { key: Buffer | null }).key?.equals(key)).toBe(true);
		const plain = employeeStoreFor({ payroll: {} });
		expect((plain as unknown as { key: Buffer | null }).key).toBeNull();
	});

	it('provides the service and its stores, needs the ledger, and is wired into the app', () => {
		expect(Reflect.getMetadata('imports', PayrollModule)).toEqual([LedgerModule, DocumentsModule, OrdersSetupModule]);
		expect(Reflect.getMetadata('controllers', PayrollModule)).toEqual([PayrollController, PayrollSetupController]);
		expect(Reflect.getMetadata('providers', PayrollModule)).toEqual([
			PayrollService,
			PayrollRulesService,
			SalaryTemplatesService,
			PayrollReturnsService,
			PayrollAdvancesService,
			{ provide: PAYROLL_RULES_REPOSITORY, useClass: MongoPayrollRulesRepository },
			{ provide: SALARY_TEMPLATE_REPOSITORY, useClass: MongoSalaryTemplateRepository },
			{ provide: STATUTORY_FILING_REPOSITORY, useClass: MongoStatutoryFilingRepository },
			{ provide: PAYROLL_ADVANCE_REPOSITORY, useClass: MongoPayrollAdvanceRepository },
			{ provide: EMPLOYEE_REPOSITORY, inject: [APP_CONFIG], useFactory: employeeStoreFor },
			{ provide: ATTENDANCE_REPOSITORY, useClass: MongoAttendanceRepository },
		]);
		// The run store is shared app-wide now: the ledger's month checks read it too.
		const persistence = Reflect.getMetadata('providers', PersistenceModule) as {
			provide?: unknown;
			useClass?: unknown;
		}[];
		expect(persistence).toContainEqual({ provide: PAYROLL_RUN_REPOSITORY, useClass: MongoPayrollRunRepository });
		expect(Reflect.getMetadata('exports', PersistenceModule)).toContain(PAYROLL_RUN_REPOSITORY);
		expect(AppModule.forRoot({} as never).imports).toContain(PayrollModule);
	});
});

describe('the payroll key in the configuration', () => {
	it('takes a 32-byte base64 key, and is optional', () => {
		const key = randomBytes(32).toString('base64');
		expect(load({ PAYROLL_PII_KEY: key }).payroll).toEqual({ piiKey: key });
		expect(load().payroll.piiKey).toBeUndefined();
		expect(load({ PAYROLL_PII_KEY: '' }).payroll.piiKey).toBeUndefined();
	});

	it('refuses a key of any other length', () => {
		expect(() => load({ PAYROLL_PII_KEY: randomBytes(16).toString('base64') })).toThrow(
			/PAYROLL_PII_KEY must be 32 bytes, base64/,
		);
	});
});
