import { Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { Subject, debounceTime, switchMap, catchError, of } from 'rxjs';

import { blockId } from '@core/shipping/blocks';
import { ShippingGateway, shippingProblemKey } from '@core/shipping/shipping.gateway';

import type {
	AdminProductRow,
	ShippingRuleSetBody,
	ShippingTestCart,
	ShippingTraceEntry,
	ShippingTryRequest,
	ShippingTryResult,
} from '@saha-textile/contracts';

/** Delivery countries Try it offers first; any other ISO code can be typed. */
const COUNTRIES = ['IN', 'AE', 'US', 'GB', 'CA', 'AU', 'SG', 'NZ', 'DE', 'FR', 'BD', 'NP', 'SA', 'QA', 'MY'];

interface TryLine {
	productId: string;
	title: string;
	quantity: number;
}

/**
 * Try it (brief rb02, rb03): a cart of real products, priced by the blocks as they stand on the
 * server, with each line's result explained. Nothing is saved; a cart can be kept as a test cart.
 */
@Component({
	selector: 'app-srb-try',
	templateUrl: './srb-try.html',
	imports: [FormsModule, TranslocoModule],
})
export class SrbTry {
	readonly body = input.required<ShippingRuleSetBody>();
	readonly readOnly = input(false);
	readonly saveTestCart = output<ShippingTestCart>();

	private readonly gateway = inject(ShippingGateway);
	private readonly transloco = inject(TranslocoService);

	readonly countries = COUNTRIES;
	readonly lines = signal<TryLine[]>([]);
	readonly country = signal('IN');
	readonly state = signal('West Bengal');
	readonly pincode = signal('700001');
	readonly signedIn = signal(true);
	readonly firstOrder = signal(false);
	readonly results = signal<AdminProductRow[]>([]);
	readonly outcome = signal<ShippingTryResult | null>(null);
	readonly problem = signal<string | null>(null);
	readonly naming = signal(false);
	readonly cartName = signal('');

	private readonly asks = new Subject<ShippingTryRequest | null>();

	constructor() {
		const sub = this.asks
			.pipe(
				debounceTime(400),
				switchMap((ask) =>
					ask === null
						? of(null)
						: this.gateway.tryIt(ask).pipe(
								catchError((error: unknown) => {
									this.problem.set(shippingProblemKey(error));
									return of(null);
								}),
							),
				),
			)
			.subscribe((result) => {
				if (result) this.problem.set(null);
				this.outcome.set(result);
			});
		inject(DestroyRef).onDestroy(() => sub.unsubscribe());
		effect(() => this.asks.next(this.request()));
	}

	readonly request = computed<ShippingTryRequest | null>(() => {
		const lines = this.lines();
		if (lines.length === 0) return null;
		return {
			body: this.body(),
			lines: lines.map((line) => ({ productId: line.productId, variationId: null, quantity: line.quantity })),
			delivery: this.delivery(),
			shopper: { signedIn: this.signedIn(), groups: [], firstOrder: this.firstOrder() },
		};
	});

	private delivery() {
		const country = this.country().trim().toUpperCase();
		return {
			country,
			state: country === 'IN' ? this.state().trim() || null : null,
			pincode: this.pincode().trim() || null,
		};
	}

	countryName(code: string): string {
		try {
			return new Intl.DisplayNames([this.transloco.getActiveLang()], { type: 'region' }).of(code) ?? code;
		} catch {
			return code;
		}
	}

	search(text: string) {
		const search = text.trim();
		if (search.length < 2) return this.results.set([]);
		this.gateway.searchProducts(search).subscribe((list) => this.results.set(list.items));
	}

	pick(row: AdminProductRow) {
		this.lines.update((lines) => {
			const same = lines.find((line) => line.productId === row.id);
			return same
				? lines.map((line) => (line === same ? { ...line, quantity: Math.min(99, line.quantity + 1) } : line))
				: [...lines, { productId: row.id, title: row.title, quantity: 1 }];
		});
		this.results.set([]);
	}

	setQuantity(index: number, value: unknown) {
		const quantity = Math.max(1, Math.min(99, Math.round(Number(value) || 1)));
		this.lines.update((lines) => lines.map((line, i) => (i === index ? { ...line, quantity } : line)));
	}

	removeLine(index: number) {
		this.lines.update((lines) => lines.filter((_, i) => i !== index));
	}

	/** One line's amount: the trace entries that priced that line alone. */
	lineAmount(lineId: string): number | null {
		const entries = (this.outcome()?.trace ?? []).filter(
			(entry) => entry.lineIds.length === 1 && entry.lineIds[0] === lineId,
		);
		return entries.length ? entries.reduce((sum, entry) => sum + entry.amountINR, 0) : null;
	}

	/** Why, in short: each step's entries as words (2 units × ₹100, free, first unit then further units). */
	readonly why = computed(() => {
		const result = this.outcome();
		if (!result) return '';
		const titles = new Map(
			result.lines.map((line, i) => [line.lineId, `${this.transloco.translate('ship_line')} ${i + 1}`] as const),
		);
		return result.trace
			.map((entry) => {
				const who =
					entry.lineIds.length === 1
						? (titles.get(entry.lineIds[0] ?? '') ?? '')
						: this.transloco.translate('ship_whole_cart');
				return `${who}: ${this.explain(entry)}`;
			})
			.join(' · ');
	});

	private explain(entry: ShippingTraceEntry): string {
		const t = (key: string, params?: Record<string, string | number>) => this.transloco.translate(key, params);
		const rupees = (n: number | undefined) => `₹${(n ?? 0).toLocaleString('en-IN')}`;
		switch (entry.result) {
			case 'free':
				return t('ship_why_free');
			case 'none':
				return t('ship_why_none');
			case 'cantShip':
				return t('ship_why_cant_ship');
			case 'courierQuote':
				return t('ship_why_courier');
			case 'firstAndFurther':
				return t('ship_why_first_further', {
					first: rupees(entry.firstINR),
					units: entry.furtherUnits ?? 0,
					further: rupees(entry.furtherINR),
				});
			case 'percent':
				return t('ship_why_percent', { percent: entry.percent ?? 0, amount: rupees(entry.amountINR) });
			default:
				if (entry.kg !== undefined)
					return t('ship_why_kg', {
						kg: entry.kg,
						each: rupees(entry.unitAmountINR),
						amount: rupees(entry.amountINR),
					});
				if (entry.units !== undefined && entry.unitAmountINR !== undefined)
					return t('ship_why_units', { units: entry.units, each: rupees(entry.unitAmountINR) });
				return rupees(entry.amountINR);
		}
	}

	keep() {
		const name = this.cartName().trim();
		const request = this.request();
		if (!name || !request) return;
		this.saveTestCart.emit({
			id: blockId('cart'),
			name: name.slice(0, 80),
			lines: request.lines.map((line) => ({
				productId: line.productId,
				variationId: line.variationId ?? null,
				quantity: line.quantity,
			})),
			delivery: {
				country: request.delivery.country,
				state: request.delivery.state ?? null,
				pincode: request.delivery.pincode ?? null,
			},
			shopper: {
				signedIn: request.shopper.signedIn,
				groups: request.shopper.groups ?? [],
				firstOrder: request.shopper.firstOrder,
			},
			expectedINR: null,
		});
		this.naming.set(false);
		this.cartName.set('');
	}
}
