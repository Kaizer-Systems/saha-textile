import { Component, OnInit, computed, inject, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import {
	type ContentBlock,
	ContentBlocksGateway,
	HERO_LAYOUT_SLOTS,
	type HeroLayout,
} from '@core/media/content-blocks.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { BannerSlotForm } from './banner-slot-form/banner-slot-form';

/**
 * Home banners (owner log § Media → Banners and content blocks; approved wireframe 2).
 *
 * The hero layout is one setting, picked from the theme-options `selection-box` cards. The
 * storefront renders each layout with the theme's own hero markup in our colours. Below it,
 * one form per slot of the chosen layout, and the newsletter popup image.
 */
@Component({
	selector: 'app-home-banners',
	templateUrl: './home-banners.html',
	imports: [PageWrapper, TranslocoModule, BannerSlotForm],
})
export class HomeBanners implements OnInit {
	private readonly gateway = inject(ContentBlocksGateway);
	private readonly notifications = inject(NotificationService);

	readonly layouts: HeroLayout[] = ['hero_full', 'hero_main_side', 'hero_main_stack', 'hero_center_sides'];
	readonly layout = signal<HeroLayout>('hero_full');
	readonly heroBlocks = signal<ContentBlock[]>([]);
	readonly popupBlock = signal<ContentBlock | null>(null);
	readonly loaded = signal(false);

	readonly slots = computed(() => HERO_LAYOUT_SLOTS[this.layout()]);

	async ngOnInit(): Promise<void> {
		await this.reload();
	}

	block(slot: string): ContentBlock | null {
		return this.heroBlocks().find((block) => block.slot === slot) ?? null;
	}

	async chooseLayout(layout: HeroLayout): Promise<void> {
		try {
			this.layout.set(await firstValueFrom(this.gateway.setHeroLayout(layout)));
			this.notifications.showSuccess('Hero layout saved.');
		} catch {
			this.notifications.showError('The hero layout could not be saved.');
		}
	}

	async reload(): Promise<void> {
		const [layout, home, global] = await Promise.all([
			firstValueFrom(this.gateway.heroLayout()),
			firstValueFrom(this.gateway.list('home')),
			firstValueFrom(this.gateway.list('global')),
		]);
		this.layout.set(layout);
		this.heroBlocks.set(home.filter((block) => block.position === 'hero'));
		this.popupBlock.set(global.find((block) => block.position === 'newsletter_popup') ?? null);
		this.loaded.set(true);
	}
}
