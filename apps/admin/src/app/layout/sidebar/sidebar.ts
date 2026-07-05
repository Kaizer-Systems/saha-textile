import { isPlatformBrowser, NgTemplateOutlet, AsyncPipe } from '@angular/common';
import { Component, inject, input, PLATFORM_ID } from '@angular/core';
import { NavigationEnd, Router, RouterModule } from '@angular/router';

import { toObservable } from '@angular/core/rxjs-interop';
import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { AccountStore } from '@core/state/account.store';
import { MenuStore } from '@core/state/menu.store';
import { SettingStore } from '@core/state/setting.store';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { IMenu } from '@data-access/interfaces/menu.interface';
import { IValues } from '@data-access/interfaces/setting.interface';
import { NavService } from '@data-access/services/nav.service';

@Component({
	selector: 'app-sidebar',
	templateUrl: './sidebar.html',
	styleUrls: ['./sidebar.scss'],
	imports: [RouterModule, NgTemplateOutlet, HasPermissionDirective, TranslateModule, AsyncPipe, NgTemplateOutlet],
})
export class Sidebar {
	navServices = inject(NavService);
	private platformId = inject<Object>(PLATFORM_ID);
	private router = inject(Router);
	private menuStore = inject(MenuStore);
	private accountStore = inject(AccountStore);

	readonly class = input<string>(undefined);

	setting$: Observable<IValues | null> = toObservable(inject(SettingStore).setting);
	readonly menu = this.menuStore.menu;

	public item: IMenu;
	public menuItems: IMenu[] = [];
	public permissions: string[] = [];
	public sidebarTitleKey: string = 'sidebar';

	constructor() {
		this.menuItems = this.menuStore.menu();
		void this.router.events.subscribe((event) => {
			if (event instanceof NavigationEnd) {
				this.menuItems?.forEach((menu: IMenu) => {
					menu.active = false;
					this.activeMenuRecursive(menu, event.url.split('?')[0].toString().split('/')[1].toString());
				});
			}
		});
	}

	hasMainLevelMenuPermission(acl_permission?: string[]) {
		let status = true;
		if (acl_permission?.length) {
			this.permissions = this.accountStore.permissions()?.map((value) => value?.name);
			if (!acl_permission?.some((action) => this.permissions?.includes(action))) {
				status = false;
			}
		}
		return status;
	}

	sidebarToggle() {
		this.navServices.collapseSidebar = !this.navServices.collapseSidebar;
	}

	onItemSelected(item: IMenu, onRoute: boolean = false) {
		this.menuItems.forEach((menu: IMenu) => {
			this.deActiveAllMenu(menu, item);
		});
		if (!onRoute) item.active = !item.active;
	}

	activeMenuRecursive(menu: IMenu, url: string, item?: IMenu) {
		if (menu && menu.path && menu.path == (url.charAt(0) !== '/' ? '/' + url : url)) {
			if (item) {
				item.active = true;
				this.onItemSelected(item, true);
			}
			menu.active = true;
		}
		if (menu?.children?.length) {
			menu?.children.forEach((child: IMenu) => {
				this.activeMenuRecursive(child, url.charAt(0) !== '/' ? '/' + url : url.toString(), menu);
			});
		}
	}

	deActiveAllMenu(menu: IMenu, item: IMenu) {
		if (menu && menu.active && menu.id != item.id) {
			menu.active = false;
		}
		if (menu?.children?.length) {
			menu?.children.forEach((child: IMenu) => {
				this.deActiveAllMenu(child, item);
			});
		}
	}

	closeSidebar() {
		if (isPlatformBrowser(this.platformId)) {
			// For SSR
			if (window.innerWidth < 992) {
				this.navServices.collapseSidebar = false;
			}
		}
	}
}
