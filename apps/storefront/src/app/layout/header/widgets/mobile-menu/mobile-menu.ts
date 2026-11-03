import { Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { IMobileMenu } from '@data-access/interfaces/menu.interface';

@Component({
	selector: 'app-mobile-menu',
	templateUrl: './mobile-menu.html',
	styleUrls: ['./mobile-menu.scss'],
	imports: [RouterLink, TranslocoModule],
})
export class MobileMenu {
	private router = inject(Router);

	public menuItem: IMobileMenu[] = [
		{
			id: 1,
			active: true,
			title: 'home',
			icon: 'ri-home-2',
			path: '/',
		},
		{
			id: 2,
			active: false,
			title: 'category',
			icon: 'ri-apps-line js',
			path: '/collections',
		},
		{
			id: 3,
			active: false,
			title: 'search',
			icon: 'ri-search-2',
			path: '/search',
		},
		{
			id: 4,
			active: false,
			title: 'my_wish',
			icon: 'ri-heart-3',
			path: '/wishlist',
		},
		{
			id: 5,
			active: false,
			title: 'cart',
			icon: 'fly-cate ri-shopping-bag',
			path: '/cart',
		},
	];

	constructor() {
		void this.router.events.subscribe((event) => {
			if (event instanceof NavigationEnd) {
				this.menuItem?.forEach((menu: IMobileMenu) => {
					menu.active = false;
					if (event.url.split('?')[0].toString() === menu.path) {
						menu.active = true;
					}
				});
			}
		});
	}

	activeMenu(menu: IMobileMenu) {
		this.menuItem.forEach((item) => {
			this.menuItem.includes(menu);
			item.active = false;
		});
		menu.active = !menu.active;
	}
}
