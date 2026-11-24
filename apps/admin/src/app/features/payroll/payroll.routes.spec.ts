import { describe, expect, it } from 'vitest';

import routes from './payroll.routes';

describe('the payroll routes', () => {
	it('opens the runs by default and loads a page for each payroll screen', async () => {
		expect(routes[0]).toEqual({ path: '', pathMatch: 'full', redirectTo: 'runs' });
		const pages: Record<string, string> = {};
		for (const route of routes)
			if ('loadComponent' in route) pages[route.path] = ((await route.loadComponent()) as { name: string }).name;
		expect(pages).toEqual({
			employees: 'EmployeesPage',
			attendance: 'AttendancePage',
			runs: 'PayrollRunPage',
			'runs/:month/payslips/:employeeId': 'PayslipPage',
			structures: 'SalaryStructuresPage',
			advances: 'AdvancesPage',
			'advances/:employeeId': 'AdvancesPage',
			statutory: 'StatutoryReturnsPage',
		});
	});
});
