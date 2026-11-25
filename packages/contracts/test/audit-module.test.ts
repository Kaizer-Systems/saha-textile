import { describe, expect, it } from 'vitest';

import { AuditLogListQuery } from '../src/audit';

/** The audit log by module (brief 26 AU1): the first part of an action, `payroll` for `payroll.payslip.edit`. */

describe('the audit log by module', () => {
	it('asks for no module unless one is chosen', () => {
		expect(AuditLogListQuery.parse({})).not.toHaveProperty('module');
	});

	it('takes a module in small letters and underscores, starting with a letter', () => {
		for (const module of ['payroll', 'accounts', 'year_close', 'gst'])
			expect(AuditLogListQuery.parse({ module }).module).toBe(module);
	});

	it('refuses capitals, a dot, a digit or underscore first, a space, and nothing', () => {
		for (const module of ['Payroll', 'payroll.payslip', '_payroll', '2fa', 'year close', '', 'payroll-run'])
			expect(AuditLogListQuery.safeParse({ module }).success).toBe(false);
	});

	it('keeps the module beside the paging the address carries', () => {
		expect(AuditLogListQuery.parse({ module: 'payroll', page: '2' })).toMatchObject({ module: 'payroll', page: 2 });
	});
});
