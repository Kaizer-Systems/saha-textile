import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbNavModule } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { YouTubeGateway } from '@core/media/content-blocks.gateway';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { injectStorefrontSearchSettingsQuery } from '@data-access/queries/search-term.queries';
import { NotificationService } from '@data-access/services/notification.service';
import { SearchTermService } from '@data-access/services/search-term.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { AdvancedDropdown } from '@shared/ui/advanced-dropdown/advanced-dropdown';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';

import { SHARE_APPS, type ShareApp, type YouTubeFeedStatus } from '@saha-textile/contracts';

/**
 * Store front › Storefront settings (brief approved 2026-11-08): small shop-wide switches, one
 * group per side tab in the Theme Options layout. Search is the first group; YouTube (video page
 * brief, 2026-11-10) holds the channel, the home rail and the daily refresh's state. Sharing
 * (share brief D4) holds the share menu's shop-wide choices.
 */
@Component({
	selector: 'app-storefront-setting',
	templateUrl: './storefront-setting.html',
	imports: [
		PageWrapper,
		FormsModule,
		NgbNavModule,
		FormFields,
		AdvancedDropdown,
		Button,
		HasPermissionDirective,
		TranslocoModule,
		DatePipe,
	],
})
export class StorefrontSetting {
	private terms = inject(SearchTermService);
	private notifier = inject(NotificationService);
	private transloco = inject(TranslocoService);
	private queryClient = inject(QueryClient);
	private youtube = inject(YouTubeGateway);

	active = 'search';
	private readonly settingsQuery = injectStorefrontSearchSettingsQuery();
	private readonly categoriesQuery = injectCategoriesQuery(() => ({ type: 'product', status: 1 }));
	readonly categories = computed(() => this.categoriesQuery.data()?.data ?? []);
	/** The saved categories, handed to the picker once; picks after that stay inside it. */
	readonly saved = signal<string[]>([]);
	readonly showFirst = signal<string[]>([]);

	/** The YouTube tab. Null until the API has answered. */
	readonly channelHandle = signal('');
	readonly displayCount = signal(8);
	readonly onHome = signal(true);
	readonly youtubeLoaded = signal(false);
	private placements: string[] = ['home'];
	readonly status = signal<YouTubeFeedStatus | null>(null);
	readonly refreshing = signal(false);

	/** The Sharing tab. Saved only once it has loaded, so a slow read never overwrites it with defaults. */
	readonly shareApps = SHARE_APPS;
	readonly xHandle = signal('');
	readonly hashtags = signal(true);
	readonly stripText = signal('');
	readonly listedApps = signal<ShareApp[]>([...SHARE_APPS]);
	readonly shareLoaded = signal(false);

	constructor() {
		this.terms.getShareSettings().subscribe((settings) => {
			this.xHandle.set(settings.xHandle);
			this.hashtags.set(settings.hashtags);
			this.stripText.set(settings.stripText);
			this.listedApps.set([...settings.apps]);
			this.shareLoaded.set(true);
		});
		this.youtube.settings().subscribe((settings) => {
			this.channelHandle.set(settings.channelHandle);
			this.displayCount.set(settings.displayCount);
			this.placements = settings.railPlacements;
			this.onHome.set(settings.railPlacements.includes('home'));
			this.youtubeLoaded.set(true);
		});
		this.loadStatus();
		effect(() => {
			const settings = this.settingsQuery.data();
			if (!settings) return;
			this.saved.set([...settings.showFirstCategoryIds]);
			this.showFirst.set([...settings.showFirstCategoryIds]);
		});
	}

	selectShowFirst(ids: string[]) {
		if (Array.isArray(ids)) this.showFirst.set(ids.map(String));
	}

	/** Ticks an app on or off, keeping the menu's own order. */
	toggleApp(app: ShareApp, on: boolean): void {
		const listed = new Set(this.listedApps());
		if (on) listed.add(app);
		else listed.delete(app);
		this.listedApps.set(SHARE_APPS.filter((item) => listed.has(item)));
	}

	loadStatus(): void {
		this.youtube.status().subscribe((status) => this.status.set(status));
	}

	/** Queues the daily refresh now; the status line reads again once it has had time to run. */
	refreshNow(): void {
		this.refreshing.set(true);
		this.youtube.refresh().subscribe({
			next: () => {
				this.notifier.showSuccess(this.transloco.translate('youtube_refresh_started'));
				setTimeout(() => {
					this.refreshing.set(false);
					this.loadStatus();
				}, 15_000);
			},
			error: () => {
				this.refreshing.set(false);
				this.notifier.showError(this.transloco.translate('youtube_refresh_failed'));
			},
		});
	}

	submit() {
		if (this.shareLoaded()) {
			this.terms
				.saveShareSettings({
					xHandle: this.xHandle().trim(),
					hashtags: this.hashtags(),
					stripText: this.stripText().trim(),
					apps: this.listedApps(),
				})
				.subscribe({
					error: () => this.notifier.showError(this.transloco.translate('share_settings_rejected')),
				});
		}
		if (this.youtubeLoaded()) {
			const others = this.placements.filter((placement) => placement !== 'home');
			this.youtube
				.saveSettings({
					channelHandle: this.channelHandle().trim(),
					displayCount: Math.min(24, Math.max(1, Math.round(this.displayCount()))),
					railPlacements: this.onHome() ? ['home', ...others] : others,
				})
				.subscribe({
					error: () => this.notifier.showError(this.transloco.translate('youtube_settings_rejected')),
				});
		}
		this.terms.saveSearchSettings({ showFirstCategoryIds: this.showFirst() }).subscribe({
			next: () => {
				void this.queryClient.invalidateQueries({ queryKey: ['storefront-settings'] });
				this.notifier.showSuccess(this.transloco.translate('storefront_settings_saved'));
			},
			error: () => this.notifier.showError(this.transloco.translate('storefront_settings_rejected')),
		});
	}
}
