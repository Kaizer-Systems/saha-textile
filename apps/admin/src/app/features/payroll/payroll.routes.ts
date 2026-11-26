import type { Routes } from '@angular/router';

/** Payroll (accounts brief S): employees, structures, attendance, runs and payslips, advances, statutory returns. */
export default [
	{ path: '', pathMatch: 'full', redirectTo: 'runs' },
	{ path: 'employees', loadComponent: () => import('./employees-page').then((m) => m.EmployeesPage) },
	{ path: 'attendance', loadComponent: () => import('./attendance-page').then((m) => m.AttendancePage) },
	{
		path: 'my-attendance',
		loadComponent: () => import('./my-attendance-page').then((m) => m.MyAttendancePage),
	},
	{ path: 'runs', loadComponent: () => import('./payroll-run-page').then((m) => m.PayrollRunPage) },
	{
		path: 'runs/:month/payslips/:employeeId/edit',
		loadComponent: () => import('./payslip-edit-page').then((m) => m.PayslipEditPage),
	},
	{
		path: 'runs/:month/payslips/:employeeId',
		loadComponent: () => import('./payslip-page').then((m) => m.PayslipPage),
	},
	{
		path: 'structures',
		loadComponent: () => import('./salary-structures-page').then((m) => m.SalaryStructuresPage),
	},
	{ path: 'increments', loadComponent: () => import('./increments-page').then((m) => m.IncrementsPage) },
	{ path: 'advances', loadComponent: () => import('./advances-page').then((m) => m.AdvancesPage) },
	{ path: 'advances/:employeeId', loadComponent: () => import('./advances-page').then((m) => m.AdvancesPage) },
	{
		path: 'statutory',
		loadComponent: () => import('./statutory-returns-page').then((m) => m.StatutoryReturnsPage),
	},
] satisfies Routes;
