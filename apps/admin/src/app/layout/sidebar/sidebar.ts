import { isPlatformBrowser, NgTemplateOutlet, AsyncPipe } from '@angular/common';
import { Component, inject, input, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { AuthStore } from '@core/state/auth.store';
import { MenuStore } from '@core/state/menu.store';
import { SettingStore } from '@core/state/setting.store';
import { IMenu } from '@data-access/interfaces/menu.interface';
import { IValues } from '@data-access/interfaces/setting.interface';
import { NavService } from '@data-access/services/nav.service';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

@Component({
	selector: 'app-sidebar',
	templateUrl: './sidebar.html',
	styleUrls: ['./sidebar.scss'],
	imports: [RouterModule, NgTemplateOutlet, HasPermissionDirective, TranslocoModule, AsyncPipe, NgTemplateOutlet],
})
export class Sidebar {
	navServices = inject(NavService);
	private platformId = inject<Object>(PLATFORM_ID);
	private router = inject(Router);
	private menuStore = inject(MenuStore);
	private authStore = inject(AuthStore);

	readonly class = input<string>('');

	setting$: Observable<IValues | null> = toObservable(inject(SettingStore).setting);
	readonly menu = this.menuStore.menu;

	public item: IMenu;
	public menuItems: IMenu[] = [];
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

	/** Parent row: show if the operator holds ANY of the listed codes. */
	hasMainLevelMenuPermission(acl_permission?: string[]) {
		if (!acl_permission?.length) return true;
		const permissions = this.authStore.permissions();
		return acl_permission.some((action) => permissions.includes(action));
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
		if (isPlatformBrowser(this.platformId) && window.innerWidth < 992) {
			this.navServices.collapseSidebar = true;
		}
	}
}
