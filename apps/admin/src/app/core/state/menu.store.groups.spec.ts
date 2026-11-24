import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { NavService } from '@data-access/services/nav.service';

import { MenuStore } from './menu.store';

describe('MenuStore group numbers (a group has no path)', () => {
	const store = () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [{ provide: NavService, useValue: { getBadges: () => of(null) } }],
		});
		return TestBed.inject(MenuStore);
	};

	it("sets a group's number once, and leaves the menu alone for the same number or an unknown group", () => {
		const menu = store();
		const group = menu.menu()[0];
		if (!group) throw new Error('The menu has no groups.');
		const value = Number(group.badgeValue ?? 0) + 3;
		menu.setGroupBadge(group.id as number, value);
		const set = menu.menu();
		expect(set.find((item) => item.id === group.id)?.badgeValue).toBe(value);
		menu.setGroupBadge(group.id as number, value);
		expect(menu.menu()).toBe(set);
		menu.setGroupBadge(-1, 9);
		expect(menu.menu()).toBe(set);
		menu.setGroupBadge(group.id as number, 0);
	});
});
