import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, effect, inject, untracked } from '@angular/core';
import { RouterModule } from '@angular/router';

import { ActiveLanguages } from '@core/i18n/active-languages';
import { injectInboxSummaryQuery } from '@core/mailboxes/mailbox.gateway';
import { STOCK_ALERT_PERMISSIONS, injectStockAlertsQuery } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { MenuStore } from '@core/state/menu.store';
import { NavService } from '@data-access/services/nav.service';
import { ProductDraftService } from '@data-access/services/product-draft.service';
import { FmTray } from '@features/media/file-manager/fm-tray';
import { Footer } from '@layout/footer/footer';
import { Header } from '@layout/header/header';
import { QuickAdd } from '@layout/quick-add/quick-add';
import { Sidebar } from '@layout/sidebar/sidebar';
import { SidebarMenuSkeleton } from '@shared/ui/skeleton/sidebar-menu-skeleton/sidebar-menu-skeleton';

/** The Stock group in the sidebar (shared/data/menu.ts). */
const STOCK_MENU_ID = 24;

@Component({
	selector: 'app-content',
	templateUrl: './content.html',
	styleUrls: ['./content.scss'],
	imports: [Header, SidebarMenuSkeleton, Sidebar, RouterModule, Footer, FmTray, QuickAdd],
})
export class Content {
	navServices = inject(NavService);
	private menuStore = inject(MenuStore);
	private platformId = inject<Object>(PLATFORM_ID);
	private authStore = inject(AuthStore);

	/** Unread conversations across the mailboxes this person may open, asked again every minute. */
	private readonly inbox = injectInboxSummaryQuery(() => this.authStore.permissions().includes('mailbox.use'));
	/** i05: write-offs and count differences waiting, on the Stock group and its Approvals item. */
	private readonly stockAlerts = injectStockAlertsQuery(() =>
		STOCK_ALERT_PERMISSIONS.some((code) => this.authStore.permissions().includes(code)),
	);

	public isBrowser: boolean;

	constructor() {
		this.isBrowser = isPlatformBrowser(this.platformId);
		// Signed in now: the working list adds the draft languages forms show (Settings › Languages).
		if (this.isBrowser) void inject(ActiveLanguages).load();
		this.menuStore.loadBadges();
		this.navServices.sidebarLoading = false;
		effect(() => {
			const unread = (this.inbox.data() ?? []).reduce((total, mailbox) => total + (mailbox.unread ?? 0), 0);
			// The menu is read and written inside setBadge; untracked keeps that from re-running this.
			untracked(() => this.menuStore.setBadge('/inbox', unread));
		});
		// Products › Drafts: how many drafts you have (product bulk actions brief 7e), once signed in.
		const drafts = inject(ProductDraftService);
		let draftsCounted = false;
		effect(() => {
			if (draftsCounted || !this.isBrowser || !this.authStore.permissions().includes('product.index')) return;
			draftsCounted = true;
			untracked(() =>
				drafts.list({ scope: 'mine', pageSize: 1 }).subscribe({
					next: (list) => this.menuStore.setBadge('/product/drafts', list.mine),
					error: () => undefined,
				}),
			);
		});
		effect(() => {
			const waiting = this.stockAlerts.data()?.pendingApprovals ?? 0;
			untracked(() => {
				this.menuStore.setGroupBadge(STOCK_MENU_ID, waiting);
				this.menuStore.setBadge('/stock/approvals', waiting);
			});
		});
	}
}
