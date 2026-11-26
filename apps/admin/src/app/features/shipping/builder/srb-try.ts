import {
	Component,
	DestroyRef,
	type ElementRef,
	computed,
	effect,
	inject,
	input,
	output,
	signal,
	viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { foreignAmountFromINR } from '@saha-textile/core-domain/shipping';
import { Observable, Subject, catchError, debounceTime, of, switchMap } from 'rxjs';

import { currencyDisplayName, injectFxOverviewQuery } from '@core/fx/fx.gateway';
import { blockId } from '@core/shipping/blocks';
import { ShippingGateway, shippingProblemKey } from '@core/shipping/shipping.gateway';
import { lineFigures, lineSubline, rupees, tryExplanation, type TryLineFigures } from '@core/shipping/try-words';
import { AuthStore } from '@core/state/auth.store';

import type {
	AdminProductRow,
	ShippingCartTryResult,
	ShippingRuleSetBody,
	ShippingRuleSetUse,
	ShippingSnapshotDelivery,
	ShippingTestCart,
	ShippingTraceEntry,
	ShippingTryLineView,
	ShippingTryResult,
} from '@saha-textile/contracts';

/** Where Try it can send a cart (brief rb02 "India · Kolkata 700001", rb03 "United Kingdom · London"). */
interface Destination {
	key: string;
	country: string;
	city: string;
	state: string | null;
	pincode: string | null;
}
const DESTINATIONS: Destination[] = [
	{ key: 'in-kolkata', country: 'IN', city: 'Kolkata', state: 'West Bengal', pincode: '700001' },
	{ key: 'in-mumbai', country: 'IN', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
	{ key: 'in-delhi', country: 'IN', city: 'Delhi', state: 'Delhi', pincode: '110001' },
	{ key: 'gb', country: 'GB', city: 'London', state: null, pincode: null },
	{ key: 'us', country: 'US', city: 'New York', state: null, pincode: null },
	{ key: 'ae', country: 'AE', city: 'Dubai', state: null, pincode: null },
	{ key: 'ca', country: 'CA', city: 'Toronto', state: null, pincode: null },
	{ key: 'au', country: 'AU', city: 'Sydney', state: null, pincode: null },
	{ key: 'sg', country: 'SG', city: 'Singapore', state: null, pincode: null },
	{ key: 'nz', country: 'NZ', city: 'Auckland', state: null, pincode: null },
	{ key: 'bd', country: 'BD', city: 'Dhaka', state: null, pincode: null },
];
/** Countries "Another address" offers; any other ISO code can't be typed in Try it. */
const COUNTRIES = ['IN', 'AE', 'US', 'GB', 'CA', 'AU', 'SG', 'NZ', 'DE', 'FR', 'BD', 'NP', 'SA', 'QA', 'MY'];

interface TryLine {
	productId: string;
	title: string;
	quantity: number;
}

type AnyResult = ShippingTryResult | ShippingCartTryResult;

/**
 * Try it (brief rb02, rb03, rb05, rb07, rb09, rb10): a cart of real products priced on the server,
 * each line explained. In the builder it prices the blocks as they stand; on the Overview
 * (`mode = 'live'`, the cart tester of ov01) it prices with the live settings, the way checkout will:
 * the Free shipping switch, exceptions and each zone's active rule set.
 */
@Component({
	selector: 'app-srb-try',
	templateUrl: './srb-try.html',
	imports: [FormsModule, TranslocoModule],
})
export class SrbTry {
	readonly body = input<ShippingRuleSetBody | null>(null);
	readonly mode = input<'ruleSet' | 'live'>('ruleSet');
	/** Which zone the rule set is for: an international one starts with a cart to the United Kingdom. */
	readonly use = input<ShippingRuleSetUse>('both');
	readonly readOnly = input(false);
	/** The blocks have mistakes: no charge can be worked out until they are fixed (rb07). */
	readonly blocked = input(false);
	/** No block gives a result yet (rb05): the box asks for a charge. */
	readonly pending = input(false);
	readonly saveTestCart = output<ShippingTestCart>();

	private readonly gateway = inject(ShippingGateway);
	private readonly transloco = inject(TranslocoService);

	readonly destinations = DESTINATIONS;
	readonly countries = COUNTRIES;
	readonly destination = signal<string>('in-kolkata');
	readonly otherCountry = signal('IN');
	readonly otherState = signal('');
	readonly otherPincode = signal('');
	/** The shopper's currency: rupees, or a currency with a stored rate (Admin › Currencies). */
	readonly currency = signal('INR');
	private readonly auth = inject(AuthStore);
	private readonly fx = injectFxOverviewQuery(() => this.auth.permissions().includes('currency.index'));
	/** The currencies a shopper can pay in besides rupees: switched on, with a rate. */
	readonly shopperCurrencies = computed(() =>
		(this.fx.data()?.currencies ?? []).filter((c) => c.stored && c.enabled && c.inrPerUnit !== null),
	);
	/** "Shown to this shopper as £34.44 at checkout" (brief rb03): the active rate with the PayPal markup. */
	readonly shownAs = computed<string | null>(() => {
		const total = this.outcome()?.amountINR;
		const chosen = this.shopperCurrencies().find((c) => c.code === this.currency());
		const markup = this.fx.data()?.settings.paypalMarkupPercent;
		if (total === null || total === undefined || !chosen?.inrPerUnit || markup === undefined) return null;
		const amount = foreignAmountFromINR(total, 1 / chosen.inrPerUnit, markup);
		return `${chosen.symbol}${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	});
	readonly lines = signal<TryLine[]>([]);
	readonly editing = signal(true);
	readonly results = signal<AdminProductRow[]>([]);
	readonly query = signal('');
	private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');
	readonly outcome = signal<AnyResult | null>(null);
	readonly problem = signal<string | null>(null);
	readonly naming = signal(false);
	readonly cartName = signal('');

	private readonly asks = new Subject<{ live: boolean; request: TryRequest } | null>();

	constructor() {
		const sub = this.asks
			.pipe(
				debounceTime(400),
				switchMap((ask) => {
					if (ask === null) return of(null);
					const call: Observable<AnyResult> = ask.live
						? this.gateway.tryCart(ask.request)
						: this.gateway.tryIt({ ...ask.request, body: this.body() ?? { steps: [], adjust: [] } });
					return call.pipe(
						catchError((error: unknown) => {
							this.problem.set(shippingProblemKey(error));
							return of(null);
						}),
					);
				}),
			)
			.subscribe((result) => {
				if (result) this.problem.set(null);
				this.outcome.set(result);
			});
		inject(DestroyRef).onDestroy(() => sub.unsubscribe());
		// An international rule set starts with a cart to the United Kingdom (brief rb03).
		effect(() => {
			if (this.use() === 'international' && this.destination() === 'in-kolkata') this.destination.set('gb');
		});
		effect(() => {
			const request = this.request();
			const live = this.mode() === 'live';
			// Blocks with mistakes can't be priced; the box says so instead (rb07).
			if (!live && (this.blocked() || this.pending())) {
				this.asks.next(null);
				return;
			}
			this.asks.next(request ? { live, request } : null);
		});
	}

	readonly request = computed<TryRequest | null>(() => {
		const lines = this.lines();
		if (lines.length === 0) return null;
		void this.body();
		return {
			lines: lines.map((line) => ({ productId: line.productId, variationId: null, quantity: line.quantity })),
			delivery: this.delivery(),
			shopper: { signedIn: true, groups: [], firstOrder: false },
		};
	});

	private delivery(): ShippingSnapshotDelivery {
		const preset = DESTINATIONS.find((d) => d.key === this.destination());
		if (preset) return { country: preset.country, state: preset.state, pincode: preset.pincode };
		const country = this.otherCountry().trim().toUpperCase();
		return {
			country,
			state: country === 'IN' ? this.otherState().trim() || null : null,
			pincode: this.otherPincode().trim() || null,
		};
	}

	countryName(code: string): string {
		try {
			// With the default fallback ('code'), of() answers a name or the code itself, never undefined.
			return new Intl.DisplayNames([this.transloco.getActiveLang()], { type: 'region' }).of(code) as string;
		} catch {
			return code;
		}
	}

	currencyName(code: string): string {
		return currencyDisplayName(code, this.transloco.getActiveLang(), (key) => this.transloco.translate(key));
	}

	destinationLabel(d: Destination): string {
		return [this.countryName(d.country), [d.city, d.pincode].filter(Boolean).join(' ')].join(' · ');
	}

	search(text: string) {
		this.query.set(text);
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
		// The search box empties once a product is added, ready for the next one.
		this.results.set([]);
		this.query.set('');
		const box = this.searchBox()?.nativeElement;
		if (box) {
			box.value = '';
			box.focus();
		}
	}

	setQuantity(index: number, value: unknown) {
		const quantity = Math.max(1, Math.min(99, Math.round(Number(value) || 1)));
		this.lines.update((lines) => lines.map((line, i) => (i === index ? { ...line, quantity } : line)));
	}

	removeLine(index: number) {
		this.lines.update((lines) => lines.filter((_, i) => i !== index));
	}

	readonly views = computed<ShippingTryLineView[]>(() => this.outcome()?.lines ?? []);
	readonly trace = computed<ShippingTraceEntry[]>(() => {
		const result = this.outcome();
		if (!result) return [];
		return 'trace' in result ? result.trace : result.groups.flatMap((group) => group.trace);
	});
	/** The blocks the trace refers to: the builder's own, or in live mode those of every rule set used. */
	private readonly blocks = computed<ShippingRuleSetBody>(() => {
		const own = this.body();
		if (own) return own;
		const result = this.outcome();
		const groups = result && 'groups' in result ? result.groups : [];
		return { steps: groups.flatMap((group) => group.body?.steps ?? []), adjust: [] };
	});
	readonly figures = computed<Map<string, TryLineFigures>>(() =>
		lineFigures(this.blocks(), this.views(), this.trace()),
	);

	subline(view: ShippingTryLineView): string {
		const t = (key: string, params?: Record<string, string | number>) => this.transloco.translate(key, params);
		const words = lineSubline(t, {
			body: this.blocks(),
			line: view,
			figures: this.figures().get(view.lineId),
			trace: this.trace(),
			zone: this.outcome()?.zone ?? 'domestic',
		});
		const variant = view.variantLabel ? `${view.variantLabel} · ` : '';
		return variant + words + this.routeWords(view);
	}

	/** Live mode: which rule set, switch or exception decided the line. */
	private routeWords(view: ShippingTryLineView): string {
		const result = this.outcome();
		if (!result || !('groups' in result)) return '';
		const line = result.lines.find((l) => l.lineId === view.lineId);
		if (!line) return '';
		const t = (key: string, params?: Record<string, string | number>) => this.transloco.translate(key, params);
		if (line.via === 'freeShippingSwitch') return ` · ${t('ship_route_free_switch')}`;
		if (line.via === 'indiaOnly') return ` · ${t('ship_route_india_only')}`;
		const exception = line.via === 'productException' || line.via === 'categoryException';
		const what =
			line.route === 'free'
				? t('ship_choice_free')
				: line.route === 'cantShip'
					? t('ship_choice_cantShip')
					: (line.ruleSetName ?? t('ship_zone_unset'));
		return ` · ${exception ? t('ship_route_exception', { what }) : what}`;
	}

	lineAmount(view: ShippingTryLineView): string {
		const amount = this.figures().get(view.lineId)?.amountINR;
		return amount === null || amount === undefined ? '' : rupees(amount);
	}

	readonly total = computed<number | null>(() => this.outcome()?.amountINR ?? null);

	readonly why = computed<string>(() => {
		const result = this.outcome();
		if (!result) return '';
		const t = (key: string, params?: Record<string, string | number>) => this.transloco.translate(key, params);
		if (result.status === 'cantShip')
			return t('ship_try_cant_ship', { message: result.cantShip[0]?.message?.['en'] ?? '' });
		if (result.status === 'noResult') return t('ship_try_no_result');
		if (result.status === 'needsQuote') return t('ship_try_needs_quote');
		if (result.status === 'unpriced') return t('ship_try_unpriced');
		if ('groups' in result && this.mode() === 'live') {
			return result.groups
				.map((group) => {
					if (group.kind === 'free') return t('ship_tester_group_free', { amount: rupees(group.amountINR) });
					const head = t('ship_tester_group', {
						name: group.ruleSetName ?? t('ship_zone_unset'),
						version: group.version ?? 0,
						amount: rupees(group.amountINR),
					});
					const detail = group.body
						? tryExplanation(t, {
								body: group.body,
								// Every line, so a line keeps its number in the whole cart.
								lines: result.lines,
								trace: group.trace,
							})
						: '';
					return detail ? `${head} ${detail}` : head;
				})
				.join(' ');
		}
		return tryExplanation(t, {
			body: this.blocks(),
			lines: result.lines,
			trace: this.trace(),
			adjustments: 'adjustments' in result ? result.adjustments : [],
		});
	});

	rupees = rupees;

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
			shopper: { signedIn: true, groups: [], firstOrder: false },
			expectedINR: null,
		});
		this.naming.set(false);
		this.cartName.set('');
	}
}

interface TryRequest {
	lines: Array<{ productId: string; variationId: string | null; quantity: number }>;
	delivery: ShippingSnapshotDelivery;
	shopper: { signedIn: boolean; groups: string[]; firstOrder: boolean };
}
