import { inject } from '@angular/core';

import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';

import { Params } from '@data-access/interfaces/core.interface';
import { IBadges, IMenu } from '@data-access/interfaces/menu.interface';
import { NavService } from '@data-access/services/nav.service';
import * as data from '@shared/data/menu';

interface MenuStateModel {
	menu: IMenu[];
	badges: IBadges | null;
}

const initialState: MenuStateModel = {
	menu: data.menu,
	badges: null,
};

function updateBadgeValueRecursive(menuItems: IMenu[], path: string, badgeValue: number) {
	for (const item of menuItems) {
		if (item.path && item.path.toString() == path.toString()) {
			item.badgeValue = badgeValue;
			break;
		}
		if (item.children) {
			updateBadgeValueRecursive(item.children, path, badgeValue);
		}
	}
}

function findBadge(menuItems: IMenu[], path: string): IMenu['badgeValue'] {
	for (const item of menuItems) {
		if (item.path === path) return item.badgeValue;
		const found = item.children ? findBadge(item.children, path) : undefined;
		if (found !== undefined) return found;
	}
	return undefined;
}

export const MenuStore = signalStore(
	{ providedIn: 'root' },
	withState(initialState),
	withMethods((store, navService = inject(NavService)) => ({
		/** One menu entry's number, such as the Inbox's unread conversations. */
		setBadge(path: string, value: number) {
			const menu = store.menu();
			if (findBadge(menu, path) === value) return;
			updateBadgeValueRecursive(menu, path, value);
			patchState(store, { menu: [...menu] });
		},
		loadBadges(payload?: Params) {
			navService.getBadges(payload).subscribe({
				next: (result) => {
					const menu = store.menu();
					updateBadgeValueRecursive(menu, '/product', result?.product?.total_in_approved_products);
					updateBadgeValueRecursive(menu, '/refund', result?.refund?.total_pending_refunds);
					patchState(store, { badges: result, menu: [...menu] });
				},
				error: (err) => {
					throw new Error(err?.error?.message);
				},
			});
		},
	})),
);
