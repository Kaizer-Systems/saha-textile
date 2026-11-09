import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, effect, inject, untracked } from '@angular/core';
import { RouterModule } from '@angular/router';

import { injectInboxSummaryQuery } from '@core/mailboxes/mailbox.gateway';
import { AuthStore } from '@core/state/auth.store';
import { MenuStore } from '@core/state/menu.store';
import { NavService } from '@data-access/services/nav.service';
import { Footer } from '@layout/footer/footer';
import { Header } from '@layout/header/header';
import { Sidebar } from '@layout/sidebar/sidebar';
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
	private platformId = inject<Object>(PLATFORM_ID);
	private authStore = inject(AuthStore);

	/** Unread conversations across the mailboxes this person may open, asked again every minute. */
	private readonly inbox = injectInboxSummaryQuery(() => this.authStore.permissions().includes('mailbox.use'));

	public isBrowser: boolean;

	constructor() {
		this.isBrowser = isPlatformBrowser(this.platformId);
		this.menuStore.loadBadges();
		this.navServices.sidebarLoading = false;
		effect(() => {
			const unread = (this.inbox.data() ?? []).reduce((total, mailbox) => total + mailbox.unread, 0);
			// The menu is read and written inside setBadge; untracked keeps that from re-running this.
			untracked(() => this.menuStore.setBadge('/inbox', unread));
		});
	}
}
