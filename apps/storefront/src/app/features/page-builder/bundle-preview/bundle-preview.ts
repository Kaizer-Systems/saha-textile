import { Component, DestroyRef, ViewEncapsulation, afterNextRender, inject, input, signal } from '@angular/core';

import { bundleFromApi } from '@core/catalog/from-api';
import { BundleConfigurator } from '@shared/ui/product-config/parts/bundle-configurator/bundle-configurator';
import { SetSummary } from '@shared/ui/product-config/parts/set-summary/set-summary';

import type { ConfiguratorState } from '@data-access/interfaces/product-detail.interface';
import type { IProduct } from '@data-access/interfaces/product.interface';
import type { CatalogPageBundle } from '@saha-textile/contracts';

/** What the bundle builder posts into the frame. */
export interface BundlePreviewMessage {
	type: 'st-bundle-preview';
	name: string;
	bundle: CatalogPageBundle | null;
}

/** True for a message the builder sent: the right shape, from the one admin origin allowed to frame this page. */
export function isBuilderMessage(
	event: MessageEvent,
	adminOrigin: string,
): event is MessageEvent<BundlePreviewMessage> {
	const data = event.data as Partial<BundlePreviewMessage> | null;
	return event.origin === adminOrigin && !!data && data.type === 'st-bundle-preview' && typeof data.name === 'string';
}

/**
 * The bundle builder's live preview (bundle builder brief, approved 2026-11-22): the shop's own set block and set
 * summary, drawn from what the builder sends as it changes. Clicking picks here never changes the bundle; it shows
 * the admin what a shopper would see and pay (owner's rev 1 message).
 */
@Component({
	selector: 'app-bundle-preview',
	template: `
		@if (product(); as item) {
			<section class="product-section">
				<div class="row g-4">
					<div class="col-xl-7">
						<div class="right-box-contain">
							<app-bundle-configurator
								[product]="item"
								[showSummary]="false"
								(stateChange)="state.set($event)"
							/>
						</div>
					</div>
					<div class="col-xl-5">
						<app-set-summary
							[bundle]="item.bundle!"
							[name]="item.name"
							[picks]="state()?.picks ?? null"
							[extras]="state()?.extras ?? null"
						/>
					</div>
				</div>
			</section>
		} @else {
			<p class="text-content p-4">{{ waiting() }}</p>
		}
	`,
	// The owner's words (rev 1): the preview is the set's part of the page alone, not the shop around it.
	styles: `
		body.st-bundle-preview app-header,
		body.st-bundle-preview app-footer,
		body.st-bundle-preview app-mobile-menu,
		body.st-bundle-preview app-cookie,
		body.st-bundle-preview app-cookie-settings {
			display: none !important;
		}
	`,
	encapsulation: ViewEncapsulation.None,
	imports: [BundleConfigurator, SetSummary],
})
export class BundlePreview {
	readonly adminOrigin = input<string | null>(null);
	readonly product = signal<IProduct | null>(null);
	readonly state = signal<ConfiguratorState | null>(null);
	readonly waiting = signal('');

	constructor() {
		const destroy = inject(DestroyRef);
		afterNextRender(() => {
			document.body.classList.add('st-bundle-preview');
			destroy.onDestroy(() => document.body.classList.remove('st-bundle-preview'));
			const origin = this.adminOrigin();
			if (!origin || window.parent === window) return;
			const listen = (event: MessageEvent) => {
				if (!isBuilderMessage(event, origin)) return;
				const { bundle, name } = event.data;
				// A new draft is a new block: the configurator starts from the set's included picks again.
				this.product.set(null);
				this.state.set(null);
				if (bundle)
					queueMicrotask(() => this.product.set({ name, bundle: bundleFromApi(bundle, '') } as IProduct));
			};
			window.addEventListener('message', listen);
			window.parent.postMessage({ type: 'st-bundle-preview-ready' }, origin);
			destroy.onDestroy(() => window.removeEventListener('message', listen));
		});
	}
}
