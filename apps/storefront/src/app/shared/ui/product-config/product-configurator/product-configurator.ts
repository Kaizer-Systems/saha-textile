import { Component, OnInit, computed, effect, input, output, signal } from '@angular/core';

import { CarouselComponent } from 'ngx-owl-carousel-o';

import { ICartAddOrUpdate, ICartLineConfig } from '@data-access/interfaces/cart.interface';
import { ConfiguratorState, IConfiguratorSummary } from '@data-access/interfaces/product-detail.interface';
import { IProduct, IVariation } from '@data-access/interfaces/product.interface';

import { AddonGroup } from '../parts/addon-group/addon-group';
import { AttributesInfo } from '../parts/attributes-info/attributes-info';
import { BundleConfigurator } from '../parts/bundle-configurator/bundle-configurator';
import { VariationAxis } from '../parts/variation-axis/variation-axis';

/**
 * Shared, host-agnostic composition of a product's configurable sections —
 * filter_only pills + variation axis + add-on groups + bundle — gated purely by
 * data presence, so a product may render several at once. It owns all selection
 * state and the price/validity maths, reports an `IConfiguratorSummary` to its
 * host, and hands back a ready `ICartAddOrUpdate` via `buildParams()`. Both the
 * PDP buy-box and the config modal render this, so the two never drift.
 */
@Component({
	selector: 'app-product-configurator',
	templateUrl: './product-configurator.html',
	styleUrls: ['./product-configurator.scss'],
	imports: [AttributesInfo, VariationAxis, AddonGroup, BundleConfigurator],
})
export class ProductConfigurator implements OnInit {
	readonly product = input.required<IProduct>();
	/** PDP gallery carousel to sync on variant change (optional; the modal has no gallery). */
	readonly owlCar = input<CarouselComponent>();
	/** Saved line snapshot to re-seed selections when editing an existing cart line. */
	readonly initialConfig = input<ICartLineConfig>();

	readonly summaryChange = output<IConfiguratorSummary>();

	readonly selectedVariation = signal<IVariation | null>(null);
	readonly addonState = signal<ConfiguratorState | null>(null);
	readonly bundleState = signal<ConfiguratorState | null>(null);

	// Sections the product actually has — composed additively (a product may have several at once,
	// e.g. a Colour variation axis AND a Blouse-Design add-on). Gated purely by data presence.
	readonly hasFilterAttrs = computed(() => !!this.product().semantic_attributes?.length);
	readonly hasVariation = computed(() => !!(this.product().attributes?.length && this.product().variations?.length));
	readonly hasAddon = computed(() => !!this.product().addon_groups?.length);
	readonly hasBundle = computed(() => !!this.product().bundle);

	/** Prefill maps handed to the child parts when editing a saved line. */
	readonly addonSeed = computed(() => this.initialConfig()?.raw?.addon_selections);
	readonly bundleSeed = computed(() => this.initialConfig()?.raw?.bundle_selections);
	readonly measurementSeed = computed(() => this.initialConfig()?.raw?.measurements);

	/** Base price the add-on delta stacks onto: selected variant → bundle kit price → product base. */
	readonly effectiveBase = computed(() => {
		const p = this.product();
		const v = this.selectedVariation();
		if (v) return v.sale_price;
		if (this.hasBundle()) return p.bundle!.bundle_price;
		return p.sale_price;
	});

	readonly displayPrice = computed(() => this.effectiveBase());
	readonly comparePrice = computed(() => this.selectedVariation()?.price ?? this.product().price);
	readonly discount = computed(() => this.selectedVariation()?.discount ?? this.product().discount);
	readonly unitPrice = computed(
		() => this.effectiveBase() + (this.addonState()?.delta ?? 0) + (this.bundleState()?.delta ?? 0),
	);

	/** Purchasable only when EVERY present section is satisfied. */
	readonly purchasable = computed(() => {
		const p = this.product();
		const baseStockOk = this.hasVariation()
			? this.selectedVariation()?.stock_status === 'in_stock'
			: this.hasBundle()
				? true // bundle validity already covers component availability
				: p.stock_status === 'in_stock';
		const addonOk = !this.hasAddon() || (this.addonState()?.valid ?? false);
		const bundleOk = !this.hasBundle() || (this.bundleState()?.valid ?? false);
		return baseStockOk && addonOk && bundleOk;
	});

	/** True only when genuinely out of stock — not merely awaiting add-on/bundle configuration. */
	readonly soldOut = computed(() => {
		if (this.hasVariation()) {
			const v = this.selectedVariation();
			return (v ? v.stock_status : this.product().stock_status) === 'out_of_stock';
		}
		if (this.hasBundle()) return false; // "configure first", components show their own stock
		return this.product().stock_status === 'out_of_stock';
	});

	readonly summary = computed<IConfiguratorSummary>(() => ({
		displayPrice: this.displayPrice(),
		comparePrice: this.comparePrice(),
		discount: this.discount() ?? 0,
		unitPrice: this.unitPrice(),
		purchasable: this.purchasable(),
		soldOut: this.soldOut(),
		hasFilterAttrs: this.hasFilterAttrs(),
		hasVariation: this.hasVariation(),
		hasAddon: this.hasAddon(),
		hasBundle: this.hasBundle(),
	}));

	constructor() {
		// Push every recomputed summary up to whichever host renders us.
		effect(() => this.summaryChange.emit(this.summary()));
	}

	ngOnInit() {
		// Deterministically seed the selected variant for edit prefill. The swatch UI
		// self-selects from the cart, but its async emit can miss the modal wiring race,
		// so we set the price-driving variant here from the saved snapshot directly.
		const variationId = this.initialConfig()?.raw?.variation_id;
		if (variationId != null) {
			const variation = this.product().variations?.find((v) => v.id === variationId);
			if (variation) this.selectedVariation.set(variation);
		}
	}

	selectVariation(variation: IVariation | null) {
		// Ignore a late null from the swatch's async init when we already have a seeded variant.
		if (variation == null && this.selectedVariation() != null && this.initialConfig()?.raw?.variation_id != null) {
			return;
		}
		this.selectedVariation.set(variation);
	}

	onAddonChange(state: ConfiguratorState) {
		this.addonState.set(state);
	}

	onBundleChange(state: ConfiguratorState) {
		this.bundleState.set(state);
	}

	/** Compose the cart payload for the current selections. `existingId` updates a line in place (edit). */
	buildParams(quantity: number, existingId: number | null): ICartAddOrUpdate {
		const variation = this.selectedVariation();
		return {
			id: existingId,
			product_id: this.product().id,
			product: this.product(),
			variation: variation,
			variation_id: variation?.id ?? null,
			quantity,
			unit_price: this.unitPrice(),
			line_config: this.buildLineConfig(),
		};
	}

	/** Snapshot the composed configuration (readable arrays for display + a raw map for edit round-trip). */
	private buildLineConfig(): ICartLineConfig {
		const p = this.product();
		const addonSel = this.addonState()?.selections ?? {};
		const bundleSel = this.bundleState()?.selections ?? {};
		const meas = this.addonState()?.measurements ?? this.bundleState()?.measurements;

		const cfg: ICartLineConfig = {
			variation_label: this.selectedVariation()?.name || undefined,
			base_price: this.effectiveBase(),
			delta_total: (this.addonState()?.delta ?? 0) + (this.bundleState()?.delta ?? 0),
			raw: {
				variation_id: this.selectedVariation()?.id ?? null,
				addon_selections: this.hasAddon() ? addonSel : undefined,
				bundle_selections: this.hasBundle() ? bundleSel : undefined,
				measurements: meas && Object.keys(meas).length ? meas : undefined,
			},
		};

		if (this.hasAddon()) {
			cfg.addon_options = (p.addon_groups ?? []).map((g) => {
				const term = g.terms.find(
					(t) => t.code === (addonSel[g.code] ?? g.default_term_code ?? g.terms[0]?.code),
				);
				return { group: g.label, value: term?.label ?? '', price_delta: term?.price_delta ?? 0 };
			});
		}

		if (this.hasBundle() && p.bundle) {
			cfg.bundle_options = (p.bundle.option_groups ?? []).map((g) => {
				const term = g.terms.find(
					(t) => t.code === (bundleSel[g.code] ?? g.default_term_code ?? g.terms[0]?.code),
				);
				return { group: g.label, value: term?.label ?? '', price_delta: term?.price_delta ?? 0 };
			});
			cfg.bundle_components = p.bundle.components.map((c) => ({ name: c.name, sku: c.sku, price: c.price }));
		}

		const fields = p.measurement_fields ?? p.bundle?.measurement_fields;
		if (meas && fields && Object.keys(meas).length) {
			cfg.measurements = fields
				.filter((f) => meas[f.code] != null)
				.map((f) => ({ label: f.label, value: meas[f.code], unit: f.unit }));
		}

		return cfg;
	}
}
