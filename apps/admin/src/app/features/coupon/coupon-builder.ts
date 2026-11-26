import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbNavModule } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Select2, Select2Data, Select2SearchEvent, Select2UpdateEvent } from 'ng-select2-component';
import { Subject, debounceTime, firstValueFrom, switchMap } from 'rxjs';

import { COUPONS_KEY, CouponsGateway, injectCouponListQuery } from '@core/coupons/coupons.gateway';
import { OrdersGateway } from '@core/orders/orders.gateway';
import { apiProblem, rupees } from '@core/purchasing/purchasing-format';
import { ICategory } from '@data-access/interfaces/category.interface';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { NotificationService } from '@data-access/services/notification.service';
import { ProductService } from '@data-access/services/product.service';
import { isoToLocalInput, localInputToIso } from '@features/zone/zone-editor';

import type { Coupon, CouponFields, CouponTryResult, CouponWrite } from '@saha-textile/contracts';

export type CouponTab = 'general' | 'discount' | 'items' | 'who' | 'dates' | 'combining';

/** A new coupon as the builder opens it: 10% off the whole order, once per customer, not combining (OD4). */
export function blankCoupon(): CouponWrite {
	return {
		code: '',
		title: '',
		kind: 'percentOff',
		value: 10,
		capINR: null,
		scope: { kind: 'wholeOrder' },
		excludedProductIds: [],
		includeSaleItems: false,
		includeSets: true,
		minOrderINR: 0,
		audience: { kind: 'everyone' },
		channels: { shop: true, admin: true },
		usesPerCustomer: 1,
		totalUses: null,
		validFrom: null,
		validUntil: null,
		combines: false,
		usableOnZonePrices: false,
		enabled: false,
	};
}

const FIELD_KEYS = [
	'code',
	'title',
	'kind',
	'value',
	'capINR',
	'scope',
	'excludedProductIds',
	'includeSaleItems',
	'includeSets',
	'minOrderINR',
	'audience',
	'channels',
	'usesPerCustomer',
	'totalUses',
	'validFrom',
	'validUntil',
	'combines',
	'usableOnZonePrices',
] as const satisfies ReadonlyArray<keyof CouponFields>;

/** Only the coupon's own fields: no id, counts, switch or revision. */
export function couponFieldsOf(source: CouponFields): CouponFields {
	return Object.fromEntries(FIELD_KEYS.map((key) => [key, source[key]])) as CouponFields;
}

/** The coupon in plain words, line by line (cp02 "In plain words"). */
export function couponWords(
	coupon: CouponWrite,
	t: (key: string, params?: Record<string, string | number>) => string,
	nameOf: (id: string) => string = (id) => id,
	others?: { combining: string[]; alone: string[] },
): string[] {
	const lines: string[] = [];
	if (coupon.kind === 'freeDelivery') lines.push(t('cpn_words_free_delivery'));
	else {
		const gives =
			coupon.kind === 'percentOff'
				? t('cpn_words_percent', { value: coupon.value })
				: t('cpn_words_amount', { amount: rupees(coupon.value) });
		lines.push(
			coupon.capINR !== null ? `${gives} ${t('cpn_words_cap', { amount: rupees(coupon.capINR) })}` : gives,
		);
	}
	const scope = coupon.scope;
	const where =
		scope.kind === 'wholeOrder'
			? t('cpn_words_whole_order')
			: scope.kind === 'categories'
				? t(scope.includeSubcategories ? 'cpn_words_categories_subs' : 'cpn_words_categories', {
						list: scope.categoryIds.map(nameOf).join(', '),
					})
				: t('cpn_words_products', { count: scope.productIds.length });
	lines.push(
		`${where}${coupon.includeSaleItems ? '' : t('cpn_words_not_sale')}${coupon.includeSets ? '' : t('cpn_words_not_sets')}`,
	);
	if (coupon.excludedProductIds.length)
		lines.push(t('cpn_words_excluded', { count: coupon.excludedProductIds.length }));
	if (coupon.minOrderINR > 0) lines.push(t('cpn_words_min', { amount: rupees(coupon.minOrderINR) }));
	const who = t(`cpn_words_audience_${coupon.audience.kind}`);
	const channels = [
		coupon.channels.shop ? t('cpn_words_shop') : '',
		coupon.channels.admin ? t('cpn_words_admin') : '',
	]
		.filter(Boolean)
		.join(t('cpn_words_and'));
	const uses =
		coupon.usesPerCustomer === null
			? t('cpn_words_unlimited')
			: coupon.usesPerCustomer === 1
				? t('cpn_words_once_per_customer')
				: t('cpn_words_per_customer', { count: coupon.usesPerCustomer });
	lines.push(`${who}, ${channels}, ${uses}`);
	if (coupon.totalUses !== null) lines.push(t('cpn_words_total', { count: coupon.totalUses }));
	// cp04: name the switched-on coupons this one can and can't be used with.
	if (coupon.combines && others && (others.combining.length || others.alone.length)) {
		if (others.combining.length) lines.push(t('cpn_words_can_with', { codes: others.combining.join(', ') }));
		else lines.push(t('cpn_words_combines'));
		if (others.alone.length) lines.push(t('cpn_words_cant_with', { codes: others.alone.join(', ') }));
	} else lines.push(t(coupon.combines ? 'cpn_words_combines' : 'cpn_words_alone'));
	if (coupon.usableOnZonePrices) lines.push(t('cpn_words_zone'));
	if (coupon.kind !== 'freeDelivery') lines.push(t('cpn_words_never_delivery'));
	return lines;
}

function flatten(rows: readonly ICategory[] = [], depth = 0): Array<{ id: string; label: string }> {
	return rows.flatMap((row) => [
		{ id: String(row.id), label: `${'— '.repeat(depth)}${row.name}` },
		...flatten((row as { subcategories?: ICategory[] }).subcategories ?? [], depth + 1),
	]);
}

/**
 * The coupon builder (brief cp02–cp05, OD4): the theme's vertical-tab form made real. General,
 * Discount (% off, ₹ off or free delivery, a cap), Items (whole order, categories or products,
 * products left out, sale pieces off by default, a minimum order), Who can use it (everyone, first
 * order, chosen customers or businesses; shop and/or admin), Dates and limits, Combining (with the
 * "Usable on zone prices" switch). "Check it" reads it back in plain words and tries it on a real
 * cart. Save as draft keeps it off; Save and switch on turns it on.
 */
@Component({
	selector: 'app-coupon-builder',
	templateUrl: './coupon-builder.html',
	imports: [NgbNavModule, RouterModule, Select2, TranslocoModule],
})
export class CouponBuilder {
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly gateway = inject(CouponsGateway);
	private readonly orders = inject(OrdersGateway);
	private readonly products = inject(ProductService);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = inject(QueryClient);
	private readonly destroyRef = inject(DestroyRef);

	readonly id = signal<string | null>(this.route.snapshot.paramMap.get('id'));
	/** cp04: the switched-on coupons, so the plain words can name what this one combines with. */
	private readonly switchedOn = injectCouponListQuery(() => ({ filter: 'on', page: 1, pageSize: 100 }));
	readonly saved = signal<Coupon | null>(null);
	readonly draft = signal<CouponWrite>(blankCoupon());
	active: CouponTab = 'discount';
	readonly saving = signal(false);
	readonly error = signal<string | null>(null);

	private readonly categoriesQuery = injectCategoriesQuery(() => ({ type: 'product' }));
	readonly categories = computed(() => flatten(this.categoriesQuery.data()?.data ?? []));
	readonly categoryOptions = computed<Select2Data>(() =>
		this.categories().map((row) => ({ value: row.id, label: row.label })),
	);
	private readonly names = signal<Map<string, string>>(new Map());
	readonly productOptions = signal<Select2Data>([]);
	readonly buyerOptions = signal<Select2Data>([]);
	private readonly productSearch = new Subject<string>();

	/** The other switched-on coupons that combine (cp04's "Can be used with" and Try it). */
	readonly combiningCodes = computed(() =>
		(this.switchedOn.data()?.items ?? [])
			.filter((row) => row.id !== this.id() && !row.expired && row.combines)
			.map((row) => row.code),
	);
	/** cp02: "Cart: 3 pieces · delivery ₹100". */
	readonly tryPieces = computed(() => this.tryItems().reduce((sum, row) => sum + row.quantity, 0));

	readonly words = computed(() => {
		const t = (key: string, params?: Record<string, string | number>) => this.transloco.translate(key, params);
		const names = new Map([
			...this.categories().map((row) => [row.id, row.label.replace(/^(— )+/, '')] as const),
			...this.names(),
		]);
		const others = (this.switchedOn.data()?.items ?? []).filter((row) => row.id !== this.id() && !row.expired);
		return couponWords(this.draft(), t, (id) => names.get(id) ?? id, {
			combining: others.filter((row) => row.combines).map((row) => row.code),
			alone: others.filter((row) => !row.combines).map((row) => row.code),
		});
	});

	readonly tryItems = signal<Array<{ productId: string; label: string; quantity: number }>>([]);
	/** 0: the server works out this cart's home-country delivery charge. */
	readonly tryDelivery = signal(0);
	readonly tryResult = signal<CouponTryResult | null>(null);
	readonly trying = signal(false);

	readonly toLocal = isoToLocalInput;
	readonly fromLocal = localInputToIso;

	constructor() {
		this.productSearch
			.pipe(
				debounceTime(250),
				switchMap((search) => this.products.getCatalogProducts({ search, pageSize: 15 })),
				takeUntilDestroyed(this.destroyRef),
			)
			.subscribe((list) => {
				const names = new Map(this.names());
				for (const row of list.items) names.set(row.id, `${row.title} · ${row.sku}`);
				this.names.set(names);
				this.productOptions.set(
					this.keepChosen(list.items.map((row) => ({ value: row.id, label: `${row.title} · ${row.sku}` }))),
				);
			});
		this.productSearch.next('');
		const id = this.id();
		const from = this.route.snapshot.queryParamMap.get('from');
		if (id) void this.load(id, false);
		else if (from) void this.load(from, true);
	}

	private chosenProducts(): string[] {
		const d = this.draft();
		return [...(d.scope.kind === 'products' ? d.scope.productIds : []), ...d.excludedProductIds];
	}

	private keepChosen(rows: Select2Data): Select2Data {
		const seen = new Set(rows.map((row) => String((row as { value: unknown }).value)));
		const extra = [...new Set(this.chosenProducts())]
			.filter((id) => !seen.has(id))
			.map((id) => ({ value: id, label: this.names().get(id) ?? id }));
		return [...extra, ...rows];
	}

	/** Edit loads the coupon; Duplicate loads a copy with an empty code, switched off. */
	private async load(id: string, copy: boolean): Promise<void> {
		try {
			const coupon = await firstValueFrom(this.gateway.get(id));
			this.draft.set({
				...couponFieldsOf(coupon),
				enabled: copy ? false : coupon.enabled,
				...(copy ? { code: '' } : {}),
			});
			if (!copy) this.saved.set(coupon);
			this.productOptions.update((rows) => this.keepChosen(rows));
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('ord_action_failed')));
		}
	}

	money(amount: number): string {
		return rupees(amount);
	}

	patch(change: Partial<CouponWrite>): void {
		this.draft.update((d) => ({ ...d, ...change }));
	}

	num(value: string): number {
		const parsed = Number(String(value).replace(/[₹,%\s]/g, ''));
		return Number.isFinite(parsed) ? parsed : 0;
	}

	optionalNum(value: string): number | null {
		return String(value).trim() ? this.num(value) : null;
	}

	setKind(kind: CouponWrite['kind']): void {
		this.patch({ kind, value: kind === 'freeDelivery' ? 0 : kind === 'percentOff' ? 10 : 500, capINR: null });
	}

	setScope(kind: CouponWrite['scope']['kind']): void {
		if (kind === 'wholeOrder') this.patch({ scope: { kind } });
		else if (kind === 'categories')
			this.patch({ scope: { kind, categoryIds: [] as unknown as [string], includeSubcategories: true } });
		else this.patch({ scope: { kind, productIds: [] as unknown as [string] } });
	}

	ids(event: Select2UpdateEvent): string[] {
		return (Array.isArray(event.value) ? event.value : []).map(String);
	}

	setScopeIds(event: Select2UpdateEvent): void {
		const scope = this.draft().scope;
		if (scope.kind === 'categories') this.patch({ scope: { ...scope, categoryIds: this.ids(event) as [string] } });
		if (scope.kind === 'products') this.patch({ scope: { ...scope, productIds: this.ids(event) as [string] } });
	}

	scopeIds(): string[] {
		const scope = this.draft().scope;
		return scope.kind === 'categories' ? scope.categoryIds : scope.kind === 'products' ? scope.productIds : [];
	}

	setAudience(kind: CouponWrite['audience']['kind']): void {
		this.buyerOptions.set([]);
		if (kind === 'customers') this.patch({ audience: { kind, customerIds: [] as unknown as [string] } });
		else if (kind === 'businesses') this.patch({ audience: { kind, businessIds: [] as unknown as [string] } });
		else this.patch({ audience: { kind } });
	}

	audienceIds(): string[] {
		const audience = this.draft().audience;
		return audience.kind === 'customers'
			? audience.customerIds
			: audience.kind === 'businesses'
				? audience.businessIds
				: [];
	}

	setAudienceIds(event: Select2UpdateEvent): void {
		const audience = this.draft().audience;
		if (audience.kind === 'customers')
			this.patch({ audience: { ...audience, customerIds: this.ids(event) as [string] } });
		if (audience.kind === 'businesses')
			this.patch({ audience: { ...audience, businessIds: this.ids(event) as [string] } });
	}

	/** Customers by name, phone or email; businesses by name, phone or GSTIN (the Create order searches). */
	async searchBuyers(event: Select2SearchEvent): Promise<void> {
		const q = event.search.trim();
		if (!q) return;
		const kind = this.draft().audience.kind;
		const rows =
			kind === 'businesses'
				? (await firstValueFrom(this.orders.searchBusinesses(q))).map((row) => ({
						value: row.id,
						label: row.tradeName || row.legalName,
					}))
				: (await firstValueFrom(this.orders.searchCustomers(q))).map((row) => ({
						value: row.id,
						label: row.name,
					}));
		const chosen = new Set(this.audienceIds());
		const kept = this.buyerOptions().filter((row) => chosen.has(String((row as { value: unknown }).value)));
		this.buyerOptions.set([...kept, ...rows.filter((row) => !chosen.has(row.value))]);
	}

	searchProducts(event: Select2SearchEvent): void {
		this.productSearch.next(event.search);
	}

	addTryItem(event: Select2UpdateEvent): void {
		const id = event.value === null || event.value === undefined ? '' : String(event.value);
		if (!id || this.tryItems().some((row) => row.productId === id) || this.tryItems().length >= 20) return;
		this.tryItems.update((rows) => [...rows, { productId: id, label: this.names().get(id) ?? id, quantity: 1 }]);
	}

	removeTryItem(productId: string): void {
		this.tryItems.update((rows) => rows.filter((row) => row.productId !== productId));
	}

	usedCodes(result: CouponTryResult): string {
		return result.used.map((row) => row.code).join(' + ');
	}

	async tryIt(): Promise<void> {
		if (!this.tryItems().length) return;
		this.trying.set(true);
		try {
			const coupon = couponFieldsOf(this.draft());
			this.tryResult.set(
				await firstValueFrom(
					this.gateway.tryIt({
						coupon: { ...coupon, code: coupon.code || 'TRYIT' },
						items: this.tryItems().map((row) => ({
							productId: row.productId,
							variantId: null,
							quantity: row.quantity,
						})),
						deliveryINR: this.tryDelivery(),
						// cp04: a coupon that combines is tried with the switched-on coupons that also combine.
						withCodes: coupon.combines ? this.combiningCodes() : [],
					}),
				),
			);
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.trying.set(false);
		}
	}

	canSave(): boolean {
		const d = this.draft();
		return (
			!this.saving() &&
			/^[A-Z0-9][A-Z0-9-]{2,23}$/.test(d.code) &&
			!!d.title.trim() &&
			(d.channels.shop || d.channels.admin)
		);
	}

	async save(enabled: boolean): Promise<void> {
		if (!this.canSave()) return;
		this.saving.set(true);
		this.error.set(null);
		try {
			const saved = await firstValueFrom(
				this.gateway.save(this.id(), {
					...this.draft(),
					enabled,
					...(this.saved() ? { revision: this.saved()?.revision } : {}),
				}),
			);
			void this.queryClient.invalidateQueries({ queryKey: [...COUPONS_KEY] });
			this.notifier.showSuccess(this.transloco.translate(enabled ? 'cpn_saved_on' : 'cpn_saved_draft'));
			void this.router.navigate(['/coupon']);
			return void saved;
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.saving.set(false);
		}
	}
}
