import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { CheckoutGateway, followHandoff, type CheckoutCartLine } from '@core/checkout/checkout.gateway';
import { injectGeoCountryQuery } from '@core/geo/geo.gateway';
import { AccountStore } from '@core/state/account.store';
import { CartFacade } from '@core/state/cart/cart.facade';
import { SettingStore } from '@core/state/setting.store';
import { IUserAddress } from '@data-access/interfaces/user.interface';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { NoData } from '@shared/ui/no-data/no-data';
import { ShopAddressForm } from '@shared/ui/shop-address-form/shop-address-form';

import { popupCurrencies } from './payment-return/payment-return';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

import type {
	AddressInIndiaInput,
	CheckoutAddressChoice,
	CheckoutQuote,
	PostalAddressInput,
} from '@saha-textile/contracts';

/** "new" or a saved address's server id. */
type Choice = 'new' | string;

/** An amount in the order's currency, the way the shop writes money. */
export function shopMoney(amount: number, currency: string): string {
	if (currency === 'INR') return `₹${Math.round(amount).toLocaleString('en-IN')}`;
	try {
		return new Intl.NumberFormat('en-GB', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount);
	} catch {
		return `${currency} ${amount.toFixed(2)}`;
	}
}

/**
 * Shop › Checkout (shipping brief shop01–shop06, approved 19 Nov; orders brief shop07–shop17, approved
 * 20 Nov), built on the ported Fastkart checkout markup (checkout-section-2, checkout-detail-box,
 * delivery-address-box, pos-detail-card, summary-total, coupon box). Delivery and billing come from
 * saved addresses or a new one with the country rules; the optional "Address in India" step shows
 * only when the server says so (both abroad, export off) and never mentions invoices; the shipping
 * line explains itself; coupons say why they did or didn't apply; Pay stays off while a piece can't
 * be sent. The server prices every step and picks the gateway from the currency.
 */
@Component({
	selector: 'app-checkout',
	templateUrl: './checkout.html',
	imports: [Breadcrumb, NgTemplateOutlet, NoData, RouterLink, ShopAddressForm, TranslocoModule],
})
export class Checkout {
	private readonly gateway = inject(CheckoutGateway);
	private readonly account = inject(AccountStore);
	private readonly settings = inject(SettingStore);
	private readonly cartFacade = inject(CartFacade);
	private readonly transloco = inject(TranslocoService);
	private readonly doc = inject(DOCUMENT);

	public breadcrumb = translatedBreadcrumb('checkout');

	readonly addresses = computed<IUserAddress[]>(() => this.account.user()?.address ?? []);
	readonly currency = computed(() => this.settings.selectedCurrency()?.code ?? 'INR');

	/* Delivery and billing (shop17): a saved address, or a new one for this order. */
	readonly deliveryChoice = signal<Choice | null>(null);
	readonly newDelivery = signal<PostalAddressInput | null>(null);
	readonly saveDelivery = signal(true);
	readonly deliveryName = signal('');
	readonly billingSame = signal(true);
	readonly billingChoice = signal<Choice | null>(null);
	readonly newBilling = signal<PostalAddressInput | null>(null);
	readonly saveBilling = signal(false);
	readonly billingName = signal('');

	/* Address in India (shop03): every field optional; only a complete one is used. */
	readonly indiaOpen = signal(true);
	readonly india = signal<AddressInIndiaInput>({
		fullName: '',
		line1: '',
		line2: '',
		city: '',
		state: '',
		postalCode: '',
	});
	readonly indiaStates = injectGeoCountryQuery(() => 'IN');

	/* Coupons (shop12, shop13). */
	readonly couponCodes = signal<string[]>([]);
	readonly couponInput = signal('');

	readonly busy = signal(false);
	readonly error = signal<string | null>(null);

	/** The default saved address starts chosen; with none saved, a new one. */
	readonly delivery = computed<Choice>(() => {
		const chosen = this.deliveryChoice();
		if (chosen) return chosen;
		const list = this.addresses();
		return (list.find((row) => row.is_default) ?? list[0])?.address_id ?? 'new';
	});
	readonly billing = computed<Choice>(() => this.billingChoice() ?? this.delivery());
	readonly pickDelivery = (choice: Choice) => this.deliveryChoice.set(choice);
	readonly pickBilling = (choice: Choice) => this.billingChoice.set(choice);

	private choiceOf(choice: Choice, typed: PostalAddressInput | null, save: boolean, name: string) {
		if (choice !== 'new') return { kind: 'saved', savedAddressId: choice } as CheckoutAddressChoice;
		if (!typed) return null;
		return {
			kind: 'new',
			address: typed,
			saveAs: save && name.trim() ? name.trim() : null,
		} as CheckoutAddressChoice;
	}

	/** What the server prices; null until the delivery address is complete. */
	readonly request = computed(() => {
		const delivery = this.choiceOf(this.delivery(), this.newDelivery(), this.saveDelivery(), this.deliveryName());
		if (!delivery) return null;
		const billing = this.billingSame()
			? null
			: this.choiceOf(this.billing(), this.newBilling(), this.saveBilling(), this.billingName());
		if (!this.billingSame() && !billing) return null;
		const india = this.india();
		const anyIndia = Object.values(india).some((value) => value.trim());
		return {
			delivery,
			billing,
			addressInIndia: anyIndia ? india : null,
			currency: this.currency(),
			couponCodes: this.couponCodes(),
		};
	});

	readonly quote = injectQuery(() => ({
		queryKey: ['shop-checkout', 'quote', this.request()],
		queryFn: () =>
			firstValueFrom(this.gateway.quote(this.request() as NonNullable<ReturnType<Checkout['request']>>)),
		enabled: !!this.request(),
		staleTime: 0,
	}));
	readonly cart = injectQuery(() => ({
		queryKey: ['shop-checkout', 'cart'],
		queryFn: () => firstValueFrom(this.gateway.cart()),
	}));
	readonly cartLines = computed(() => new Map((this.cart.data()?.lines ?? []).map((line) => [line.id, line])));

	readonly q = computed<CheckoutQuote | null>(() => this.quote.data() ?? null);
	readonly freeDelivery = computed(() => this.q()?.coupons.find((row) => row.kind === 'freeDelivery') ?? null);
	readonly goodsCoupons = computed(() => (this.q()?.coupons ?? []).filter((row) => row.kind !== 'freeDelivery'));

	money(amount: number): string {
		return shopMoney(amount, this.q()?.currency ?? this.currency());
	}

	/** A coupon's rupees in the order's currency (the quote converts at the same rate as the total). */
	couponMoney(amountINR: number): string {
		const q = this.q();
		if (!q || q.currency === 'INR') return this.rupees(amountINR);
		const rate = q.totals.totalINR ? q.totals.total / q.totals.totalINR : 1;
		return this.money(amountINR * rate);
	}

	rupees(amount: number): string {
		return shopMoney(amount, 'INR');
	}

	imageOf(lineId: string): string {
		const line: CheckoutCartLine | undefined = this.cartLines().get(lineId);
		const roles = line?.image?.roles ?? {};
		return roles['thumb']?.[0]?.url ?? roles['card']?.[0]?.url ?? 'assets/images/product.png';
	}

	/** shop01: "MRP ₹12,000 · discounted" / "Full price"; a coupon's share; why a sale piece got none. */
	lineSub(line: CheckoutQuote['lines'][number]): string {
		const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
		const cart = this.cartLines().get(line.lineId);
		const coupon = this.q()?.coupons.find((row) =>
			row.lines.some((part) => part.lineId === line.lineId && part.amountINR > 0),
		);
		if (coupon) return t('chk_line_coupon', { code: coupon.code, amount: this.money(line.couponAmount) });
		const onSale = this.q()?.coupons.some((row) =>
			row.lines.some((part) => part.lineId === line.lineId && part.reason === 'onSale'),
		);
		if (cart?.mrpINR && cart.mrpINR > cart.unitPriceINR) {
			return onSale
				? t('chk_line_on_sale_left_out', { mrp: this.rupees(cart.mrpINR) })
				: t('chk_line_mrp_discounted', { mrp: this.rupees(cart.mrpINR) });
		}
		return '';
	}

	/** The shipping line's reason, from the engine's own explanation (shop01–shop03). */
	shippingWhy(): string {
		const q = this.q();
		if (!q) return '';
		const entries = q.shipping.reason
			.map((text) => {
				try {
					return JSON.parse(text) as {
						result: string;
						units?: number;
						furtherUnits?: number;
						unitAmountINR?: number;
						amountINR: number;
						lineIds: string[];
					};
				} catch {
					return null;
				}
			})
			.filter((entry): entry is NonNullable<typeof entry> => !!entry);
		const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
		const abroad = entries.find((entry) => entry.result === 'firstAndFurther');
		if (abroad) return t('chk_ship_abroad', { count: abroad.furtherUnits ?? 0 });
		const charged = entries.filter((entry) => entry.result === 'productCharge' && entry.amountINR > 0);
		if (!charged.length) return entries.length ? t('chk_ship_all_free') : '';
		const units = charged.reduce((sum, entry) => sum + (entry.units ?? 1), 0);
		const unit = charged[0]?.unitAmountINR ?? charged[0]?.amountINR ?? 0;
		const free = entries.some((entry) => entry.result === 'free');
		const words = t(units === 1 ? 'chk_ship_discounted_one' : 'chk_ship_discounted_other', {
			count: units,
			amount: this.rupees(unit),
		});
		return free ? `${words} · ${t('chk_ship_full_price_free')}` : words;
	}

	payWords(): string {
		const q = this.q();
		const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
		if (!q) return t('chk_pay');
		if (q.payBlocked === 'pieceCannotShip') return t('chk_remove_cannot_ship');
		const total = this.money(q.totals.total);
		return q.currency === 'INR' ? t('chk_pay_amount', { amount: total }) : t('chk_pay_paypal', { amount: total });
	}

	/* ------------------------------------------------------------------ actions */

	setIndia(field: keyof AddressInIndiaInput, value: string): void {
		this.india.update((current) => ({ ...current, [field]: value }));
	}

	applyCoupon(): void {
		const code = this.couponInput().trim().toUpperCase();
		if (!code || this.couponCodes().includes(code)) return;
		this.couponCodes.update((codes) => [...codes, code]);
		this.couponInput.set('');
	}

	removeCoupon(code: string): void {
		this.couponCodes.update((codes) => codes.filter((row) => row !== code));
	}

	/** shop12, shop13: why a coupon can't apply, in plain words. */
	refusalWords(code: string, refusal: string): string {
		const others = this.couponCodes().filter((row) => row !== code);
		const allOnSale =
			refusal === 'nothingEligible' &&
			(this.q()?.lines ?? []).every((line) => {
				const cart = this.cartLines().get(line.lineId);
				return !!cart?.mrpINR && cart.mrpINR > cart.unitPriceINR;
			});
		const key = allOnSale ? 'chk_coupon_refusal_allOnSale' : `chk_coupon_refusal_${refusal}`;
		return this.transloco.translate(key, { code, others: others.join(' and ') });
	}

	/** shop09: the billing country's currency first, without ₹ (cards from abroad can't pay in ₹ yet). */
	pickerChoices(first: string) {
		return popupCurrencies(first, false);
	}

	useCurrency(code: string, symbol: string): void {
		this.settings.setCurrency({ ...(this.settings.selectedCurrency() ?? {}), code, symbol } as never);
	}

	/** shop08 / K2: "Paying from India? … Pay in ₹ instead". */
	payInRupees(): void {
		this.settings.setCurrency({ ...(this.settings.selectedCurrency() ?? {}), code: 'INR', symbol: '₹' } as never);
	}

	removeLine(lineId: string): void {
		this.cartFacade.deleteCart(lineId);
		void this.cart.refetch();
	}

	async pay(): Promise<void> {
		const request = this.request();
		const q = this.q();
		if (!request || !q || q.payBlocked || this.busy()) return;
		this.busy.set(true);
		this.error.set(null);
		try {
			const handoff = await firstValueFrom(
				this.gateway.place({ ...request, idempotencyKey: `shop-${crypto.randomUUID()}` }),
			);
			followHandoff(handoff.handoff, this.doc);
		} catch {
			this.error.set(this.transloco.translate('chk_pay_failed'));
		} finally {
			this.busy.set(false);
		}
	}
}
