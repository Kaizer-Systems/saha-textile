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

export const MenuStore = signalStore(
	{ providedIn: 'root' },
	withState(initialState),
	withMethods((store, navService = inject(NavService)) => ({
		loadBadges(payload?: Params) {
			navService.getBadges(payload).subscribe({
				next: (result) => {
					const menu = store.menu();
					updateBadgeValueRecursive(menu, '/product', result?.product?.total_in_approved_products);
					updateBadgeValueRecursive(menu, '/store', result?.store?.total_in_approved_stores);
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
