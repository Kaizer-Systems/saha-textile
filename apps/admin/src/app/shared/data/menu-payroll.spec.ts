import { describe, expect, it } from 'vitest';

import { menu } from './menu';

/** The Payroll menu (brief 26 AT1, AT2): shown for the books, for a person's own attendance, or for a store's. */

const payroll = menu.find((item) => item.title === 'payroll');
const child = (path: string) => payroll?.children?.find((item) => item.path === path);

describe('the Payroll menu', () => {
	it('shows for anyone who keeps the books, marks their own attendance, or sees a store’s', () => {
		expect(payroll?.acl_permission).toEqual(['accounts.index', 'attendance.use', 'attendance.index']);
	});

	it('opens My attendance first, for a person’s own attendance, and Attendance for a store’s month', () => {
		expect(payroll?.children?.[0]).toMatchObject({
			parent_id: 27,
			title: 'payroll_my_attendance',
			path: '/payroll/my-attendance',
			type: 'link',
			level: 2,
			permission: ['attendance.use'],
		});
		expect(child('/payroll/attendance')?.permission).toEqual(['attendance.index']);
		expect(child('/payroll/employees')?.permission).toEqual(['accounts.index']);
	});
});
