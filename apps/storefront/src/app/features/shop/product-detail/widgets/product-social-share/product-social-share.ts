import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, computed, inject, input } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import { LocaleSeo } from '@core/i18n/locale-seo';
import { IProduct } from '@data-access/interfaces/product.interface';
import { NotificationService } from '@data-access/services/notification.service';

import { ShareGroup, ShareTarget, hashtags, shareTargets, tagged } from './share-targets';

const rupees = (value: number): string => `₹${value.toLocaleString('en-IN')}`;

/**
 * The theme's "Share it" block, shown in the share popover beside wishlist and compare (owner
 * approved the share brief, 2026-11-10). It was ported with the theme and is moved here, not copied.
 *
 * Nothing is stored per product: the message is built when the menu opens, from the product on
 * the page (name, live price, chosen colour, facts) and the wording in the language files. No app
 * needs an account or key from us: each opens its own share page or the phone's share sheet.
 */
@Component({
	selector: 'app-product-social-share',
	templateUrl: './product-social-share.html',
	styleUrls: ['./product-social-share.scss'],
	imports: [TranslocoModule],
})
export class ProductSocialShare {
	private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
	private readonly seo = inject(LocaleSeo);
	private readonly notification = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);

	readonly product = input.required<IProduct>();
	/** The colour or design the shopper is looking at, so the receiver opens the same one. */
	readonly variantSku = input<string | null>(null);

	/** Phones whose share sheet takes a picture plus text get the lean menu. */
	readonly phone = this.isBrowser && matchMedia('(pointer: coarse)').matches && canSharePictures();

	readonly url = computed(() => {
		const sku = this.variantSku();
		const path = `/product/${this.product().slug}`;
		return this.seo.absoluteUrl(sku ? `${path}?variant=${encodeURIComponent(sku)}` : path);
	});

	private readonly facts = computed(() =>
		(this.product().semantic_attributes ?? []).map((fact) => fact.value).filter(Boolean),
	);

	/** Name, live price with any offer, three facts, and the invitation, in the page's language. */
	readonly message = computed(() => {
		const product = this.product();
		const price = product.sale_price || product.price;
		const percent =
			product.sale_price && product.sale_price < product.price
				? Math.round((1 - product.sale_price / product.price) * 100)
				: 0;
		const offer = percent
			? ` · MRP ${rupees(product.price)} (${this.transloco.translate('share_off', { percent })})`
			: '';
		return [
			`✨ ${product.name}`,
			`${rupees(price)}${offer}`,
			this.facts().slice(0, 3).join(' · '),
			this.transloco.translate('share_see_colours'),
		]
			.filter(Boolean)
			.join('\n');
	});

	readonly groups = computed(() => {
		const product = this.product();
		const price = rupees(product.sale_price || product.price);
		const targets = shareTargets(
			{
				name: product.name,
				url: this.url(),
				message: this.message(),
				short: `${product.name} · ${price} ${hashtags(this.facts())}`.trim(),
			},
			this.phone,
		);
		return (['send', 'post', 'story'] as ShareGroup[])
			.map((group) => ({ group, items: targets.filter((target) => target.group === group) }))
			.filter((row) => row.items.length);
	});

	appName(app: string): string {
		return app.startsWith('share_') ? this.transloco.translate(app) : app;
	}

	open(event: Event, target: ShareTarget): void {
		if (!this.isBrowser) return;
		if (target.picture) {
			event.preventDefault();
			void this.sharePicture(target);
			return;
		}
		if (!target.window || this.phone) return;
		event.preventDefault();
		window.open(target.href, `share-${target.id}`, 'popup,width=640,height=680,noopener');
	}

	/**
	 * Copies the caption first (Instagram drops text from other apps), says which share-sheet
	 * entry to pick, then opens the phone's share sheet with the right picture and the caption.
	 */
	async sharePicture(target: ShareTarget): Promise<void> {
		const caption = `${this.message()}\n${tagged(this.url(), target.id)}`;
		await navigator.clipboard?.writeText(caption).catch(() => undefined);
		if (target.hint) this.notification.showSuccess(this.transloco.translate(target.hint));
		const picture = await this.picture(target.picture === 'tall').catch(() => null);
		await navigator
			.share({ title: this.product().name, text: caption, ...(picture ? { files: [picture] } : {}) })
			.catch(() => undefined);
	}

	/** The tall card once the image pipeline has made it; until then, and for posts, the main photo. */
	private async picture(tall: boolean): Promise<File | null> {
		const product = this.product();
		const url =
			(tall ? product.share_story_image?.original_url : undefined) ?? product.product_thumbnail?.original_url;
		if (!url) return null;
		const blob = await fetch(url).then((response) => response.blob());
		return new File([blob], `${product.slug}.jpg`, { type: blob.type || 'image/jpeg' });
	}

	/** More: the phone's own share sheet with the message and link, for every other app. */
	more(): void {
		if (!this.isBrowser) return;
		navigator
			.share({ title: this.product().name, text: this.message(), url: tagged(this.url(), 'more') })
			.catch(() => undefined);
	}

	copyLink(): void {
		if (!this.isBrowser) return;
		void navigator.clipboard
			.writeText(tagged(this.url(), 'copy'))
			.then(() => this.notification.showSuccess(this.transloco.translate('link_copied')));
	}
}

/** True where the browser can hand a picture to the phone's share sheet (Android Chrome, iPhone Safari). */
export function canSharePictures(): boolean {
	if (typeof navigator.canShare !== 'function') return false;
	try {
		return navigator.canShare({ files: [new File([''], 'probe.jpg', { type: 'image/jpeg' })] });
	} catch {
		return false;
	}
}
