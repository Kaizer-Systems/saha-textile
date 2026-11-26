import { describe, expect, it } from 'vitest';

import { menu } from './menu';

/** The audit trail in the menu (brief 26 AU1): under Settings, for someone who may read the trail. */

describe('the Audit trail menu entry', () => {
	it('opens Settings › Audit trail for audit.index', () => {
		const entry = menu.flatMap((item) => item.children ?? []).find((item) => item.path === '/setting/audit-trail');
		expect(entry).toEqual({
			parent_id: 19,
			title: 'atr_title',
			path: '/setting/audit-trail',
			type: 'link',
			level: 2,
			permission: ['audit.index'],
		});
	});
});
