import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject } from '@angular/core';
import { RouterModule } from '@angular/router';

import { NavService } from '@data-access/services/nav.service';
import { Footer } from '@layout/footer/footer';
import { Header } from '@layout/header/header';
import { Sidebar } from '@layout/sidebar/sidebar';
import { AccountStore } from '@core/state/account.store';
import { MenuStore } from '@core/state/menu.store';
import { SidebarMenuSkeleton } from '@shared/ui/skeleton/sidebar-menu-skeleton/sidebar-menu-skeleton';

@Component({
	selector: 'app-content',
	templateUrl: './content.html',
	styleUrls: ['./content.scss'],
	imports: [Header, SidebarMenuSkeleton, Sidebar, RouterModule, Footer],
})
export class Content {
	navServices = inject(NavService);
	private menuStore = inject(MenuStore);
	private accountStore = inject(AccountStore);
	private platformId = inject<Object>(PLATFORM_ID);

	public isBrowser: boolean;

	constructor() {
		this.isBrowser = isPlatformBrowser(this.platformId);
		this.menuStore.loadBadges();
		this.accountStore.loadUserDetails().subscribe({
			complete: () => {
				this.navServices.sidebarLoading = false;
			},
		});
	}
}
