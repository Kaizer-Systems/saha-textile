import { describe, expect, it } from 'vitest';

import { menu } from './menu';

/** The worklist in the menu (brief 26 WL1): a top entry for everyone signed in. */

describe('the Worklist menu entry', () => {
	it('opens the Worklist from the top of the menu, with no permission asked', () => {
		const entry = menu.find((item) => item.path === '/worklist');
		expect(entry).toEqual({
			id: 28,
			title: 'wl_title',
			path: '/worklist',
			active: false,
			icon: 'ri-task-line',
			// A top-level page link, drawn like Dashboard and Inbox (the 'link' type is a submenu's and lost contrast).
			type: 'sub',
			level: 1,
		});
	});
});
