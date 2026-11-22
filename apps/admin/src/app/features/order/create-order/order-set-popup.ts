import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { quoteBundle, type QuoteBundle } from '@saha-textile/core-domain/bundle';
import { firstValueFrom } from 'rxjs';

import { rupees } from '@core/purchasing/purchasing-format';
import { BundleService } from '@data-access/services/bundle.service';

import type { BundleChoice, CatalogPageBundle, CatalogPageBundleItem } from '@saha-textile/contracts';

/** A set's page model in the shape core prices (the same mapping as core's quoteFromPage). */
function quoteOf(bundle: CatalogPageBundle): QuoteBundle {
	const item = (row: CatalogPageBundleItem) => ({
		key: row.key,
		quantity: row.quantity,
		priceInSetINR: row.priceInSetINR,
		todayINR: row.todayINR,
		onSale: row.saleINR !== null,
		perTenth: row.soldBy === 'metre',
	});
	const p = bundle.pricing;
	return {
		levels: bundle.levels.map((level) => ({
			code: level.code,
			take: level.take,
			priceMode: level.priceMode,
			items: level.items.map(item),
		})),
		extras: bundle.extras.map(item),
		method: { base: p.base, inputs: p.inputs, rules: p.methodRules, combine: p.methodCombine },
		params: p.params,
		rules: p.rules,
		combine: p.combine,
		capAtSeparately: p.capAtSeparately,
		roundTo: p.roundTo,
	};
}

/**
 * Configure a set on Create order (bundle builder brief E09, approved 2026-11-22): pick each level's pieces, a size
 * where the shopper would choose one, and the optional extras, as a shopper would; the set price is worked out by
 * core's own engine. Closes with the set's choices, which the server prices again.
 */
@Component({
	selector: 'app-order-set-popup',
	imports: [FormsModule, TranslocoModule],
	template: `
		<div class="modal-header">
			<h2 id="order_set_popup_title">{{ 'ord_set_configure_title' | transloco: { name: title() } }}</h2>
			<button
				type="button"
				class="btn btn-close"
				[title]="'close' | transloco"
				(click)="modal.dismiss()"
			>
				<i class="ri-close-line"></i>
			</button>
		</div>
		<div class="modal-body">
			@if (bundle(); as b) {
				@for (level of b.levels; track level.code; let at = $index) {
					<div class="align-items-center g-2 row mb-3">
						<label class="col-sm-4 form-label-title mb-0">
							{{ at + 1 }}. {{ level.label }}
							@if (level.items.length > level.take) {
								· {{ 'ord_set_pick_of' | transloco: { take: level.take, count: level.items.length } }}
							}
						</label>
						<div class="col-sm-8">
							@if (level.items.length > level.take && level.take === 1) {
								<select
									class="form-select"
									[ngModel]="picked(level.code)[0]"
									(ngModelChange)="pick(level.code, [$event])"
								>
									@for (item of level.items; track item.key) {
										<option
											[value]="item.key"
											[disabled]="!item.inStock"
										>
											{{ item.title }} · {{ money(item.priceInSetINR) }} ·
											{{
												item.inStock
													? ('ord_set_in_stock' | transloco)
													: ('out_of_stock' | transloco)
											}}
										</option>
									}
								</select>
							} @else if (level.items.length > level.take) {
								@for (item of level.items; track item.key) {
									<label class="d-flex align-items-center gap-2">
										<input
											type="checkbox"
											[checked]="picked(level.code).includes(item.key)"
											[disabled]="!item.inStock"
											(change)="toggle(level.code, item.key, level.take)"
										/>
										{{ item.title }} · {{ money(item.priceInSetINR) }}
									</label>
								}
							} @else {
								<div class="pt-1">
									@for (item of level.items; track item.key) {
										{{ item.title }}
										@if (!$last) {
											·
										}
									}
									<small class="help-text d-block">{{ 'ord_set_always' | transloco }}</small>
								</div>
							}
							@for (item of sizesNeeded(level.code); track item.key) {
								<select
									class="form-select mt-2"
									[ngModel]="variants()[item.key] ?? ''"
									(ngModelChange)="setVariant(item.key, $event)"
									[attr.aria-label]="'ord_set_size_for' | transloco: { name: item.title }"
								>
									<option value="">{{ 'ord_set_size_for' | transloco: { name: item.title } }}</option>
									@for (v of item.variants; track v.id) {
										<option
											[value]="v.id"
											[disabled]="!v.inStock"
										>
											{{ v.label }}
										</option>
									}
								</select>
							}
						</div>
					</div>
				}
				@if (b.extras.length) {
					<div class="align-items-center g-2 row mb-3">
						<label class="col-sm-4 form-label-title mb-0">{{ 'ord_set_extras' | transloco }}</label>
						<div class="col-sm-8">
							@for (item of b.extras; track item.key) {
								<label class="d-flex align-items-center gap-2">
									<input
										type="checkbox"
										[checked]="extras().includes(item.key)"
										[disabled]="!item.inStock"
										(change)="toggleExtra(item.key)"
									/>
									{{ item.title }} ·
									{{
										item.priceInSetINR === 0
											? ('ord_child_free' | transloco)
											: '+' + money(item.priceInSetINR)
									}}
								</label>
							}
						</div>
					</div>
				}
				@let q = quote();
				<div class="d-flex justify-content-between border-top mt-2 pt-3">
					<span>
						{{ 'ord_set_separately' | transloco }}
						<del class="text-muted">{{ money(q.separatelyINR) }}</del>
						@if (q.saveINR > 0) {
							· {{ 'ord_set_you_save' | transloco: { amount: money(q.saveINR) } }}
						}
					</span>
					<b>{{ 'ord_set_price' | transloco: { amount: money(q.totalINR) } }}</b>
				</div>
			} @else {
				<p class="text-muted mb-0">{{ 'loading' | transloco }}</p>
			}
		</div>
		<div class="modal-footer">
			<button
				type="button"
				class="btn btn-outline"
				(click)="modal.dismiss()"
			>
				{{ 'cancel' | transloco }}
			</button>
			<button
				type="button"
				class="btn btn-theme"
				[disabled]="!ready()"
				(click)="done()"
			>
				{{ 'ord_set_add' | transloco }}
			</button>
		</div>
	`,
})
export class OrderSetPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly bundles = inject(BundleService);

	readonly title = signal('');
	readonly bundle = signal<CatalogPageBundle | null>(null);
	private readonly picks = signal<Record<string, string[]>>({});
	readonly variants = signal<Record<string, string>>({});
	readonly extras = signal<string[]>([]);

	readonly money = (amount: number) => rupees(amount);

	async start(productId: string, title: string): Promise<void> {
		this.title.set(title);
		const view = await firstValueFrom(this.bundles.builder(productId));
		const page = view.page;
		if (!page) return;
		// Start from each level's first pieces in stock, as the shop does.
		this.picks.set(
			Object.fromEntries(
				page.levels.map((level) => [
					level.code,
					level.items
						.filter((item) => item.inStock)
						.slice(0, level.take)
						.map((item) => item.key),
				]),
			),
		);
		this.bundle.set(page);
	}

	picked(code: string): string[] {
		return this.picks()[code] ?? [];
	}

	pick(code: string, keys: string[]): void {
		this.picks.update((now) => ({ ...now, [code]: keys }));
	}

	toggle(code: string, key: string, take: number): void {
		const now = this.picked(code);
		this.pick(code, now.includes(key) ? now.filter((k) => k !== key) : [...now, key].slice(-take));
	}

	toggleExtra(key: string): void {
		this.extras.update((now) => (now.includes(key) ? now.filter((k) => k !== key) : [...now, key]));
	}

	setVariant(key: string, id: string): void {
		this.variants.update((now) => ({ ...now, [key]: id }));
	}

	/** The picked pieces that need a size or colour chosen. */
	sizesNeeded(code: string): CatalogPageBundleItem[] {
		const level = this.bundle()?.levels.find((row) => row.code === code);
		return (level?.items ?? []).filter(
			(item) => this.picked(code).includes(item.key) && item.variantId === null && item.variants.length > 0,
		);
	}

	readonly quote = computed(() => {
		const page = this.bundle();
		if (!page) return { totalINR: 0, separatelyINR: 0, saveINR: 0, ok: false };
		return quoteBundle(quoteOf(page), { picks: this.picks(), extras: this.extras() });
	});

	readonly ready = computed(() => {
		const page = this.bundle();
		if (!page || !this.quote().ok) return false;
		return page.levels.every(
			(level) =>
				this.picked(level.code).length === level.take &&
				this.sizesNeeded(level.code).every((item) => !!this.variants()[item.key]),
		);
	});

	done(): void {
		const choice: BundleChoice = {
			picks: this.picks(),
			variants: this.variants(),
			extras: this.extras(),
			free: {},
		};
		this.modal.close(choice);
	}
}
