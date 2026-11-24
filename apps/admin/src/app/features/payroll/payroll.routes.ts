import type { Routes } from '@angular/router';

/** Payroll (accounts brief S): employees, attendance and leave, and payroll runs. */
export default [
	{ path: '', pathMatch: 'full', redirectTo: 'runs' },
	{ path: 'employees', loadComponent: () => import('./employees-page').then((m) => m.EmployeesPage) },
	{ path: 'attendance', loadComponent: () => import('./attendance-page').then((m) => m.AttendancePage) },
	{ path: 'runs', loadComponent: () => import('./payroll-run-page').then((m) => m.PayrollRunPage) },
] satisfies Routes;
