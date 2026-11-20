import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { injectGeoCountryQuery } from '@core/geo/geo.gateway';
import { OrderDraftStore } from '@core/orders/order-draft.store';
import { couponWhy, money, shippingReason } from '@core/orders/order-format';
import { ORDERS_KEY, OrdersGateway } from '@core/orders/orders.gateway';
import { RupeesPipe, apiProblem, rupees, shortDate, shortDateTime } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { buyerLabel } from '@features/order/create-order/order-buyer-card';
import { indiaToday } from '@features/order/details/order-status-popup';
import { parseRupees } from '@features/purchasing/shared/payment-popup';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { PostalAddressForm } from '@shared/ui/postal-address-form/postal-address-form';

import { OrderCouponPopup } from './order-coupon-popup';

import type {
	AdminCartLine,
	AdminCheckoutPayment,
	AppliedCoupon,
	AdminOrderAddressChoice,
	AdminOrderCreate,
	PostalAddressInput,
	SavedAddressRow,
} from '@saha-textile/contracts';

/** The payment methods as the brief draws them (ck01–ck08), in its order. */
export const CHECKOUT_METHODS = ['paymentLink', 'upi', 'bankTransfer', 'cashOnDelivery', 'onAccount'] as const;
export type CheckoutMethod = (typeof CHECKOUT_METHODS)[number];
const METHOD_ICON: Record<CheckoutMethod, string> = {
	paymentLink: 'ri-links-line',
	upi: 'ri-qr-code-line',
	bankTransfer: 'ri-bank-line',
	cashOnDelivery: 'ri-hand-coin-line',
	onAccount: 'ri-file-list-3-line',
};

/** Where an address comes from: one of the buyer's saved addresses, or typed for this order. */
type AddressPick = { kind: 'saved'; id: string } | { kind: 'new' };

/** An idempotency key per visit, so a double click can't create two orders. */
function newKey(): string {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? `admin-order-${crypto.randomUUID()}`
		: `admin-order-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Admin › Orders › Checkout (brief ck01–ck08, ad07, cp07; concerns K2, K3, K7, K9): the theme's checkout
 * steps. Who it's for, the delivery and billing addresses (saved or typed, saved back when ticked),
 * the optional Indian invoice address when both are abroad, the shipping line from the rule sets,
 * and how the money is taken. Every figure is the server's quote; placing asks the server again.
 */
@Component({
	selector: 'app-order-checkout',
	templateUrl: './order-checkout.html',
	imports: [HasPermissionDirective, PostalAddressForm, RouterModule, RupeesPipe, TranslocoModule],
})
export class OrderCheckout {
	readonly draft = inject(OrderDraftStore);
	private readonly gateway = inject(OrdersGateway);
	private readonly router = inject(Router);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly modals = inject(NgbModal);

	readonly methods = CHECKOUT_METHODS;
	readonly methodIcon = METHOD_ICON;
	readonly key = newKey();
	readonly india = injectGeoCountryQuery(() => 'IN');

	readonly buyer = this.draft.buyer;

	/** K2 / mx01: "PayPal can’t take payments from India. Switch to ₹" — the cart is priced again in ₹. */
	switchToRupees(): void {
		this.draft.setCurrency('INR');
	}
	readonly buyerWords = computed(() => {
		const buyer = this.buyer();
		return buyer ? buyerLabel(buyer) : '';
	});
	readonly addresses = injectQuery(() => {
		const buyer = this.buyer();
		const id = buyer ? (buyer.kind === 'person' ? buyer.customer.id : buyer.business.id) : null;
		return {
			queryKey: [...ORDERS_KEY, 'buyer-addresses', buyer?.kind, id],
			queryFn: () => firstValueFrom(this.gateway.buyerAddresses(buyer?.kind ?? 'person', id as string)),
			enabled: !!id,
		};
	});
	readonly saved = computed<SavedAddressRow[]>(() => this.addresses.data() ?? []);

	readonly deliveryPick = signal<AddressPick | null>(null);
	readonly newDelivery = signal<PostalAddressInput | null>(null);
	readonly saveDelivery = signal(false);
	readonly saveDeliveryAs = signal('');
	readonly billingSame = signal(true);
	readonly billingPick = signal<AddressPick | null>(null);
	readonly newBilling = signal<PostalAddressInput | null>(null);

	readonly invoice = signal({ fullName: '', line1: '', city: '', subdivisionCode: '', postalCode: '' });
	readonly couponCodes = signal<string[]>([]);
	readonly couponText = signal('');

	readonly method = signal<CheckoutMethod>('paymentLink');
	readonly amount = signal('');
	readonly reference = signal('');
	readonly receivedOn = signal(indiaToday());
	readonly received = signal(true);
	readonly transferType = signal<'NEFT' | 'RTGS' | 'IMPS'>('NEFT');
	readonly note = signal('');
	readonly collector = signal<'staff' | 'courier'>('staff');
	readonly overrideReason = signal('');
	/** ck07: over the limit, Place order waits until staff with the override press Allow once. */
	readonly overrideAllowed = signal(false);
	readonly today = indiaToday();

	readonly busy = signal(false);
	readonly error = signal<string | null>(null);
	/** Set once the order is saved, so clearing the draft doesn't send the page back to Create order. */
	private placed = false;

	private choice(pick: AddressPick | null, typed: PostalAddressInput | null, saveAs: string | null) {
		if (!pick) return null;
		if (pick.kind === 'saved') return { kind: 'saved', savedAddressId: pick.id } satisfies AdminOrderAddressChoice;
		return typed ? ({ kind: 'new', address: typed, saveAs } satisfies AdminOrderAddressChoice) : null;
	}

	readonly deliveryChoice = computed(() =>
		this.choice(
			this.deliveryPick(),
			this.newDelivery(),
			this.saveDelivery() && this.saveDeliveryAs().trim() ? this.saveDeliveryAs().trim() : null,
		),
	);
	readonly billingChoice = computed(() =>
		this.billingSame() ? null : this.choice(this.billingPick(), this.newBilling(), null),
	);

	/** The country of an address the staff picked or typed. */
	private countryOf(pick: AddressPick | null, typed: PostalAddressInput | null): string | null {
		if (!pick) return null;
		if (pick.kind === 'new') return typed?.countryCode ?? null;
		const row = this.saved().find((address) => address.id === pick.id);
		return (row?.countryCode ?? row?.country ?? null)?.toUpperCase() ?? null;
	}
	/** ck02: both addresses abroad (export off) asks, optionally, for an address in India for the invoice. */
	readonly bothAbroad = computed(() => {
		const delivery = this.countryOf(this.deliveryPick(), this.newDelivery());
		const billing = this.billingSame() ? delivery : this.countryOf(this.billingPick(), this.newBilling());
		return !!delivery && !!billing && delivery !== 'IN' && billing !== 'IN';
	});
	readonly invoiceAddress = computed<PostalAddressInput | null>(() => {
		if (!this.bothAbroad()) return null;
		const typed = this.invoice();
		const mobile = this.newDelivery()?.mobile ?? this.mobileOf(this.deliveryPick());
		const state = (this.india.data()?.subdivisions ?? []).find((row) => row.code === typed.subdivisionCode);
		if (!typed.fullName.trim() || !typed.line1.trim() || !typed.city.trim() || !state || !mobile) return null;
		if (!/^\d{6}$/.test(typed.postalCode.trim())) return null;
		return {
			fullName: typed.fullName.trim(),
			line1: typed.line1.trim(),
			city: typed.city.trim(),
			state: state.name,
			subdivisionCode: state.code,
			postalCode: typed.postalCode.trim(),
			countryCode: 'IN',
			mobile,
		};
	});

	private mobileOf(pick: AddressPick | null) {
		if (pick?.kind !== 'saved') return null;
		return this.saved().find((address) => address.id === pick.id)?.mobile ?? null;
	}

	readonly payment = computed<AdminCheckoutPayment>(() => {
		const method = this.method();
		if (method === 'paymentLink') return { method: 'paymentLink' };
		if (method === 'cashOnDelivery') return { method: 'cashOnDelivery', collector: this.collector() };
		if (method === 'onAccount') {
			const reason = this.overrideReason().trim();
			return {
				method: 'onAccount',
				creditOverrideReason: this.overrideAllowed() && reason.length >= 3 ? reason : null,
			};
		}
		// ck04 draws no note for a bank transfer: its type goes with the payment.
		const note = method === 'bankTransfer' ? this.transferType() : this.note().trim();
		return {
			method: 'manual',
			payment: {
				method,
				amountINR: parseRupees(this.amount()) ?? 0,
				reference: this.reference().trim() || '—',
				receivedOn: this.receivedOn(),
				received: method === 'bankTransfer' ? this.received() : true,
				note: note || null,
				proofMediaId: null,
				collector: null,
				collectedBy: null,
			},
		};
	});

	/** What the server prices and places: null until there is a buyer, lines and a delivery address. */
	readonly body = computed<AdminOrderCreate | null>(() => {
		const write = this.draft.cartWrite();
		const delivery = this.deliveryChoice();
		if (!write.buyer || !write.lines.length || !delivery) return null;
		if (!this.billingSame() && !this.billingChoice()) return null;
		return {
			cart: { ...write, buyer: write.buyer },
			delivery,
			billing: this.billingChoice(),
			indianInvoiceAddress: this.invoiceAddress(),
			couponCodes: this.couponCodes(),
			payment: this.payment(),
			// ck05: the cash-on-delivery note goes on the order's first history line.
			comment: this.method() === 'cashOnDelivery' && this.note().trim() ? this.note().trim() : null,
			idempotencyKey: this.key,
		};
	});
	/** The quote ignores the payment details typed by hand, so typing a UTR doesn't ask again. */
	private readonly quoteBody = computed(() => {
		const body = this.body();
		if (!body) return null;
		const method = this.method();
		return {
			...body,
			comment: null,
			payment:
				method === 'upi' || method === 'bankTransfer'
					? ({
							method: 'manual',
							payment: { ...(body.payment as { payment: object }).payment, reference: '—', note: null },
						} as AdminCheckoutPayment)
					: body.payment,
		} as AdminOrderCreate;
	});
	readonly quote = injectQuery(() => ({
		queryKey: [...ORDERS_KEY, 'checkout-quote', this.quoteBody()],
		queryFn: () => firstValueFrom(this.gateway.checkoutQuote(this.quoteBody() as AdminOrderCreate)),
		enabled: !!this.quoteBody(),
		placeholderData: (previous) => previous,
	}));

	readonly methodOff = computed(() => {
		const off = new Map<string, string>();
		for (const row of this.quote.data()?.methodsOff ?? []) off.set(row.method, row.reason);
		if (this.buyer()?.kind !== 'business') off.set('onAccount', 'notABusiness');
		return off;
	});
	readonly shownMethods = computed(() =>
		this.methods.filter((method) => method !== 'onAccount' || this.buyer()?.kind === 'business'),
	);
	/** K9: over the limit, on account needs the override permission and a reason. */
	readonly overLimit = computed(() => this.methodOff().get('onAccount') === 'overLimit');

	readonly placeWords = computed(() => {
		const method = this.method();
		if (method === 'bankTransfer')
			return this.received()
				? this.t('ord_place_bank_received', { type: this.transferType() })
				: this.t('ord_place_bank_waiting');
		return this.t(`ord_place_${method}`);
	});

	private readonly t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);

	/** The reason under the shipping charge and in the summary (ck01–ck06). */
	readonly shipWhy = computed(() => {
		const quote = this.quote.data();
		return quote ? shippingReason(quote.shipping, this.t) : null;
	});

	/** "MRP ₹9,800 · discounted" under a cart line priced below its MRP (ck01), in the order's currency. */
	mrpLine(line: AdminCartLine): string | null {
		if (!line.mrpINR || line.mrpINR <= line.unitPriceINR) return null;
		const rate = line.unitPriceINR > 0 ? line.unitPrice / line.unitPriceINR : 1;
		const quote = this.quote.data();
		return this.t('ord_mrp_discounted', {
			mrp: money(Math.round(line.mrpINR * rate * 100) / 100, quote?.currency ?? 'INR'),
		});
	}

	couponWhyOf(coupon: AppliedCoupon): string {
		return couponWhy(coupon, (id) => this.lineTitle(id), this.t);
	}

	/** cp07: a refused coupon that doesn't combine names the coupons to remove. */
	refusalWords(refused: { code: string; refusal: string }): string {
		const applied = (this.quote.data()?.coupons ?? []).map((coupon) => coupon.code);
		if (refused.refusal === 'doesNotCombine' && applied.length)
			return this.t('ord_coupon_refused_combine', { code: refused.code, others: applied.join(' and ') });
		return `${this.t('ord_coupon_refused', { code: refused.code })} · ${this.t(`ord_coupon_refusal_${refused.refusal}`)}`;
	}

	/** ck01: who the gateway's request goes to — the billing contact. */
	readonly linkGoesTo = computed(() => {
		const buyer = this.buyer();
		if (!buyer) return '';
		if (buyer.kind === 'business')
			return [buyer.business.legalName, buyer.business.phone].filter((part) => !!part).join(' · ');
		const billing = this.billingChoice();
		const name =
			billing?.kind === 'new'
				? billing.address.fullName
				: (this.saved().find((row) => billing?.kind === 'saved' && row.id === billing.savedAddressId)
						?.fullName ?? buyer.customer.name);
		return [this.t('ord_billing_contact', { name }), buyer.customer.email, buyer.customer.phone]
			.filter((part) => !!part)
			.join(' · ');
	});

	/** ck01/ck02: "27 Nov, 15:02 (7 days); the price stays fixed until then". */
	readonly linkValidUntil = computed(() => {
		const quote = this.quote.data();
		if (!quote) return '';
		const days = quote.linkValidDays;
		const until = shortDateTime(new Date(Date.now() + days * 86_400_000).toISOString());
		return quote.currency === 'INR'
			? this.t('ord_valid_until_inr', { until, days })
			: this.t('ord_valid_until_foreign', { until, days, total: money(quote.totals.total, quote.currency) });
	});

	/** ck06/ck07: the credit box's figures. */
	readonly creditView = computed(() => {
		const credit = this.quote.data()?.credit;
		const buyer = this.buyer();
		if (!credit) return null;
		const available = Math.round((credit.limitINR - credit.usedINR) * 100) / 100;
		return {
			usedLine: this.t('ord_credit_used_line', {
				used: rupees(credit.usedINR),
				order: rupees(credit.thisOrderINR),
			}),
			limitLine: this.t('ord_credit_limit_line', { limit: rupees(credit.limitINR) }),
			after: rupees(available - credit.thisOrderINR),
			available: rupees(available),
			over: rupees(credit.usedINR + credit.thisOrderINR - credit.limitINR),
			due: credit.dueOn
				? this.t('ord_payment_due_line', {
						date: shortDate(credit.dueOn),
						days: buyer?.kind === 'business' ? buyer.business.creditDays : 0,
					})
				: null,
			name: buyer?.kind === 'business' ? buyer.business.tradeName || buyer.business.legalName : '',
		};
	});

	/** ck08: a business on credit hold, or blocked, says so in the Business step. */
	readonly standingNotice = computed(() => {
		const buyer = this.buyer();
		if (buyer?.kind !== 'business' || buyer.business.standing === 'active') return null;
		const { business } = buyer;
		const since = business.standingAt ? shortDate(business.standingAt).replace(/ \d{4}$/, '') : null;
		// "since 12 Nov, by Moulik: “Two invoices 45 days overdue.”" (ck08)
		let line = since ? this.t('ord_standing_since', { date: since }) : '';
		if (business.standingBy)
			line += `${line ? ', ' : ''}${this.t('ord_standing_by', { name: business.standingBy })}`;
		if (business.standingReason) line += `${line ? ': ' : ''}“${business.standingReason}”`;
		return { kind: business.standing, since, line, id: business.id };
	});

	/** ck08: "Credit on hold since 12 Nov" on the On account card. */
	methodOffWords(item: string, off: string): string {
		const since = this.standingNotice()?.since;
		if (off === 'creditOnHold' && since) return this.t('ord_method_off_creditOnHold_since', { date: since });
		return this.t(`ord_method_off_${off}`);
	}

	allowOnce(): void {
		if (this.overrideReason().trim().length >= 3) this.overrideAllowed.set(true);
	}

	canPlace(): boolean {
		const quote = this.quote.data();
		const method = this.method();
		if (this.busy() || !this.body() || !quote || this.quote.isFetching()) return false;
		if (quote.shipping.cannotShip.length) return false;
		const off = this.methodOff().get(method);
		if (off && !(method === 'onAccount' && off === 'overLimit' && this.overrideAllowed())) return false;
		if (method === 'upi' || method === 'bankTransfer') {
			const value = parseRupees(this.amount());
			if (value === null || value <= 0) return false;
			if (method === 'upi' && !this.reference().trim()) return false;
			if (method === 'bankTransfer' && this.received() && !this.reference().trim()) return false;
		}
		return true;
	}

	constructor() {
		// Nothing to check out: back to Create order.
		effect(() => {
			if (!this.placed && (!this.draft.buyer() || !this.draft.count())) {
				void this.router.navigateByUrl('/order/create');
			}
		});
		// The first saved address is the default delivery address; with none, a new one is typed.
		effect(() => {
			if (this.deliveryPick() || this.addresses.isPending()) return;
			const rows = this.saved();
			const preferred = rows.find((row) => row.isDefault) ?? rows[0];
			this.deliveryPick.set(preferred ? { kind: 'saved', id: preferred.id } : { kind: 'new' });
		});
		// The amount typed by hand opens at the order's ₹ total (K3).
		effect(() => {
			const total = this.quote.data()?.totals.totalINR;
			if (total !== undefined && !this.amount()) this.amount.set(String(total));
		});
	}

	/** The goods in the order's currency (lines the server can sell). */
	readonly subtotal = computed(() =>
		(this.quote.data()?.lines ?? [])
			.filter((line) => !line.problem || line.problem === 'limited')
			.reduce((sum, line) => sum + line.lineTotal, 0),
	);

	lineTitle(lineId: string): string {
		return this.quote.data()?.lines.find((line) => line.lineId === lineId)?.title ?? '';
	}

	money(amount: number): string {
		const currency = this.quote.data()?.currency ?? this.draft.currency();
		return money(amount, currency, this.transloco.getActiveLang() === 'bn' ? 'bn-IN' : 'en-IN');
	}

	addressLine(row: SavedAddressRow): string {
		return [
			row.line1,
			row.line2,
			row.landmark,
			row.city,
			row.state,
			this.countryName(row.countryCode ?? row.country),
		]
			.filter((part) => !!part && String(part).trim())
			.join(', ');
	}

	/** ad07: "Save to Kavita’s addresses" — the shop customer's first name. */
	readonly buyerName = computed(() => {
		const buyer = this.buyer();
		if (!buyer) return '';
		if (buyer.kind === 'business') return buyer.business.tradeName || buyer.business.legalName;
		return buyer.customer.name.trim().split(/\s+/)[0] ?? buyer.customer.name;
	});

	/** What a saved address's country calls its postal code (PIN code, Postcode, ZIP code). */
	postalKey(row: SavedAddressRow): string {
		const code = row.countryCode ?? row.country;
		return code === 'IN'
			? 'addr_postal_pin'
			: code === 'GB'
				? 'addr_postal_postcode'
				: code === 'US'
					? 'addr_postal_zip'
					: 'addr_postal_postal';
	}

	phoneOf(row: SavedAddressRow): string {
		return row.mobile ? `+${row.mobile.countryCallingCode} ${row.mobile.number}` : (row.phone ?? '');
	}

	countryName(code: string | null | undefined): string {
		if (!code) return '';
		try {
			return (
				new Intl.DisplayNames([this.transloco.getActiveLang() === 'bn' ? 'bn' : 'en'], { type: 'region' }).of(
					code.toUpperCase(),
				) ?? code
			);
		} catch {
			return code;
		}
	}

	setInvoice(field: 'fullName' | 'line1' | 'city' | 'subdivisionCode' | 'postalCode', value: string): void {
		this.invoice.update((current) => ({ ...current, [field]: value }));
	}

	applyCoupon(): void {
		const code = this.couponText().trim().toUpperCase();
		if (!code || this.couponCodes().includes(code)) return;
		this.couponCodes.update((codes) => [...codes, code]);
		this.couponText.set('');
	}

	/** Apply a coupon (cp06): the popup lists what each usable coupon would take off this order. */
	async openCoupons(): Promise<void> {
		const body = this.body();
		if (!body) return;
		const popup = this.modals.open(OrderCouponPopup, {
			centered: true,
			windowClass: 'theme-modal',
			ariaLabelledBy: 'order_coupon_popup_title',
		});
		await (popup.componentInstance as OrderCouponPopup).start(body);
		const code = (await popup.result.catch(() => null)) as string | null;
		if (code && !this.couponCodes().includes(code)) this.couponCodes.update((codes) => [...codes, code]);
	}

	removeCoupon(code: string): void {
		this.couponCodes.update((codes) => codes.filter((row) => row !== code));
	}

	async place(): Promise<void> {
		const body = this.body();
		if (!body || !this.canPlace()) return;
		this.busy.set(true);
		this.error.set(null);
		try {
			const detail = await firstValueFrom(this.gateway.create(body));
			const order = detail.order;
			this.placed = true;
			let toast = 'ord_order_placed';
			if (this.method() === 'paymentLink' && (order.balance?.dueINR ?? 0) > 0) {
				try {
					await firstValueFrom(
						this.gateway.requestPayment(order.id, {
							amountINR: order.balance?.dueINR ?? order.totalINR,
							currency: order.currency,
							revision: order.revision,
						}),
					);
					toast = 'ord_order_placed_request_sent';
				} catch (error) {
					// The order is saved; the request can be sent again from the order page.
					this.notifier.showError(apiProblem(error, this.transloco.translate('ord_request_not_sent')));
				}
			}
			this.draft.clear();
			this.notifier.showSuccess(this.transloco.translate(toast, { number: order.orderNumber }));
			await this.router.navigate(['/order/details', order.id]);
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}
