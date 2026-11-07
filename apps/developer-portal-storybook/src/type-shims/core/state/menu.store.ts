import { Injectable, signal } from '@angular/core';

import type { IMenu } from '../../data-access/interfaces/menu.interface';

/**
 * Storybook menu state starts empty so navigation surfaces render without
 * attempting badge requests or depending on authenticated permissions.
 */
@Injectable({ providedIn: 'root' })
export class MenuStore {
	readonly menu = signal<IMenu[]>([
		{ id: 1, title: 'Dashboard', path: '/dashboard', type: 'link', icon: 'ri-home-4-line', level: 1 },
		{
			id: 2,
			title: 'Products',
			type: 'sub',
			icon: 'ri-shirt-line',
			level: 1,
			children: [
				{ id: 3, parent_id: 2, title: 'All Products', path: '/product', type: 'link', level: 2 },
				{ id: 4, parent_id: 2, title: 'Create Product', path: '/product/create', type: 'link', level: 2 },
			],
		},
		{ id: 5, title: 'Orders', path: '/order', type: 'link', icon: 'ri-file-list-3-line', level: 1 },
	]);
	readonly badges = signal<null>(null);

	loadBadges(): void {}
}
