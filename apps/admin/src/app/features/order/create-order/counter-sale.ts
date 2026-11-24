import { Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { COUNTER_KEYS, CounterGateway } from '@core/counter/counter.gateway';
import { money } from '@core/orders/order-format';
import { OrdersGateway } from '@core/orders/orders.gateway';
import { openPdf } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { NoData } from '@shared/ui/no-data/no-data';

import { CounterPayment, type CounterPaymentStart } from './counter-payment';
import { OrderProductCard } from './order-product-card';
import { OrderSetPopup } from './order-set-popup';
import { OrderVariantPopup } from './order-variant-popup';

import type {
	AdminCartLine,
	AdminProductCard,
	AdminVariantChoice,
	BundleChoice,
	CounterLineWrite,
	CounterQuoteWrite,
	CounterSale as CounterSaleDone,
} from '@saha-textile/contracts';

/** CGST rule 46: the buyer's address is needed from ₹50,000, or with a GSTIN (repeated from the API's rule). */
export const ADDRESS_NEEDED_FROM_INR = 50_000;

/** A counter line as the screen keeps it until the sale. */
export interface CounterLine {
	key: string;
	productId: string;
	variationId: string | null;
	quantity: number;
	soldBy: 'piece' | 'metre';
	scanned: boolean;
	bundle?: BundleChoice;
}

/** A piece is sold one at a time, fabric a metre (ten tenths) at a time. */
const stepOf = (soldBy: 'piece' | 'metre') => (soldBy === 'metre' ? 10 : 1);
let counter = 0;
const nextKey = () => `c${++counter}`;

/** The order lines a sale or a quote sends: the screen's own keys and units stay behind. */
export function counterWrites(lines: readonly CounterLine[]): CounterLineWrite[] {
	return lines.map((line) => ({
		productId: line.productId,
		variationId: line.variationId,
		quantity: line.quantity,
		scanned: line.scanned,
		...(line.bundle ? { bundle: line.bundle } : {}),
	}));
}

/**
 * Counter mode in Create order (accounts brief P1): offered only to a person with a day-sheet box at a store in their
 * reach. Items are scanned by SKU or searched, the customer is optional under ₹50,000 without a GSTIN, and the totals
 * show the tax the invoice will carry. Take payment (P2) sells, invoices and prints in one go.
 */
@Component({
	selector: 'app-counter-sale',
	templateUrl: './counter-sale.html',
	imports: [TranslocoModule, FormsModule, OrderProductCard, NoData],
})
export class CounterSale {
	private readonly gateway = inject(CounterGateway);
	private readonly orders = inject(OrdersGateway);
	private readonly auth = inject(AuthStore);
	private readonly modals = inject(NgbModal);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);

	/** Create order hides its own screen while counter mode is on. */
	readonly active = output<boolean>();

	readonly here = injectQuery(() => ({
		queryKey: COUNTER_KEYS.here,
		queryFn: () => firstValueFrom(this.gateway.here()),
		enabled: this.auth.permissions().includes('cash.count'),
	}));
	readonly stores = computed(() => this.here.data()?.stores ?? []);
	readonly on = signal(false);
	/** A store picked when the chip is on all locations and there are several. */
	readonly picked = signal<string | null>(null);
	readonly store = computed(() => {
		const stores = this.stores();
		const id = this.picked() ?? this.here.data()?.current ?? (stores.length === 1 ? stores[0]?.locationId : null);
		return stores.find((s) => s.locationId === id) ?? null;
	});

	readonly lines = signal<CounterLine[]>([]);
	readonly code = signal('');
	/** Text that wasn't a SKU: matching product cards are shown to pick from. */
	readonly search = signal('');
	readonly cards = injectQuery(() => ({
		queryKey: ['counter', 'cards', this.search()],
		queryFn: () => firstValueFrom(this.orders.cards({ q: this.search(), page: 1, pageSize: 12, currency: 'INR' })),
		enabled: !!this.search(),
	}));

	readonly write = computed<CounterQuoteWrite | null>(() => {
		const store = this.store();
		return store && this.lines().length
			? { locationId: store.locationId, lines: counterWrites(this.lines()) }
			: null;
	});
	readonly quote = injectQuery(() => ({
		queryKey: COUNTER_KEYS.quote(this.write()),
		queryFn: () => firstValueFrom(this.gateway.quote(this.write() as CounterQuoteWrite)),
		enabled: this.on() && !!this.write(),
		placeholderData: (previous: unknown) => previous as never,
	}));
	/** The server answers line for line, in the order the lines were sent. */
	readonly rows = computed(() => {
		const priced = this.quote.data()?.lines ?? [];
		const lines = this.lines();
		return lines.map((line, index) => ({
			line,
			priced: priced.length === lines.length ? (priced[index] as AdminCartLine) : null,
		}));
	});
	readonly total = computed(() => (this.lines().length ? (this.quote.data()?.totalINR ?? 0) : 0));

	readonly phone = signal('');
	readonly name = signal('');
	readonly address = signal('');
	readonly gstin = signal('');
	readonly addressNeeded = computed(() => !!this.gstin().trim() || this.total() >= ADDRESS_NEEDED_FROM_INR);

	/** Take payment waits for priced lines the invoice can take, and the address when the rule needs it. */
	readonly canPay = computed(() => {
		const quote = this.quote.data();
		return (
			!!this.store() &&
			this.lines().length > 0 &&
			!this.quote.isFetching() &&
			!!quote &&
			quote.lines.length === this.lines().length &&
			!quote.problems.length &&
			quote.lines.every((line) => !line.problem || line.problem === 'limited') &&
			(!this.addressNeeded() || !!this.address().trim())
		);
	});

	toggle(on: boolean): void {
		this.on.set(on);
		this.active.emit(on);
	}

	/** Enter in the scan box: an exact SKU joins the bill as scanned; anything else searches the cards. */
	async scan(): Promise<void> {
		const code = this.code().trim();
		if (!code) return;
		try {
			const found = await firstValueFrom(this.gateway.scan(code));
			this.addLine({
				productId: found.productId,
				variationId: found.variationId,
				soldBy: found.soldBy,
				scanned: true,
			});
			this.code.set('');
			this.search.set('');
		} catch {
			this.search.set(code);
		}
	}

	/** Add from a searched card, as Create order does: a set opens Configure, variants open the picker. */
	async add(card: AdminProductCard): Promise<void> {
		if (card.isBundle) {
			const popup = this.modals.open(OrderSetPopup, {
				centered: true,
				size: 'lg',
				windowClass: 'theme-modal',
				ariaLabelledBy: 'order_set_popup_title',
			});
			void (popup.componentInstance as OrderSetPopup).start(card.productId, card.title);
			const bundle = (await popup.result.catch(() => null)) as BundleChoice | null;
			if (bundle)
				this.addLine({ productId: card.productId, variationId: null, soldBy: 'piece', scanned: false, bundle });
			return;
		}
		if (!card.hasVariants) {
			this.addLine({ productId: card.productId, variationId: null, soldBy: card.soldBy, scanned: false });
			return;
		}
		const popup = this.modals.open(OrderVariantPopup, {
			centered: true,
			size: 'lg',
			windowClass: 'theme-modal',
			ariaLabelledBy: 'order_variant_popup_title',
		});
		await (popup.componentInstance as OrderVariantPopup).start(card, 'INR', null);
		const chosen = (await popup.result.catch(() => null)) as AdminVariantChoice | null;
		if (chosen)
			this.addLine({
				productId: card.productId,
				variationId: chosen.variationId,
				soldBy: card.soldBy,
				scanned: false,
			});
	}

	/** The same item again adds to its line; a set is always its own line. */
	addLine(line: Omit<CounterLine, 'key' | 'quantity'>): void {
		const step = stepOf(line.soldBy);
		const same = this.lines().find(
			(l) => !l.bundle && !line.bundle && l.productId === line.productId && l.variationId === line.variationId,
		);
		if (same) {
			this.change(same.key, 1);
			return;
		}
		this.lines.update((lines) => [...lines, { ...line, key: nextKey(), quantity: step }]);
	}

	change(key: string, direction: 1 | -1): void {
		this.lines.update((lines) =>
			lines.flatMap((line) => {
				if (line.key !== key) return [line];
				const quantity = line.quantity + direction * stepOf(line.soldBy);
				return quantity > 0 ? [{ ...line, quantity }] : [];
			}),
		);
	}

	remove(key: string): void {
		this.lines.update((lines) => lines.filter((line) => line.key !== key));
	}

	/** A past customer found by the phone fills the name when it is still empty. */
	async lookUp(): Promise<void> {
		const digits = this.phone().replace(/\D/g, '');
		if (digits.length < 10 || this.name().trim()) return;
		try {
			const found = await firstValueFrom(this.orders.searchCustomers(digits.slice(-10)));
			const match = found.find((c) => (c.phone ?? '').replace(/\D/g, '').endsWith(digits.slice(-10)));
			if (match) this.name.set(match.name);
		} catch {
			// Not found is the same as a new customer.
		}
	}

	quantityWords(line: CounterLine): string {
		return line.soldBy === 'metre'
			? this.transloco.translate('ord_metres', { metres: (line.quantity / 10).toLocaleString('en-IN') })
			: String(line.quantity);
	}

	/** English digits in both languages. */
	rupees(amount: number): string {
		return money(amount, 'INR');
	}

	/** P2: the payment popup sells; then the invoice prints and the bill clears for the next buyer. */
	async takePayment(): Promise<void> {
		const store = this.store();
		const quote = this.quote.data();
		if (!this.canPay() || !store || !quote) return;
		const popup = this.modals.open(CounterPayment, {
			centered: true,
			size: 'lg',
			windowClass: 'theme-modal',
			ariaLabelledBy: 'counter_payment_title',
		});
		const start: CounterPaymentStart = {
			store,
			totalINR: quote.totalINR,
			taxableINR: quote.taxableINR,
			gstINR: Math.round((quote.cgstINR + quote.sgstINR) * 100) / 100,
			pieces: this.lines().reduce((sum, line) => sum + (line.soldBy === 'metre' ? 1 : line.quantity), 0),
			sale: {
				locationId: store.locationId,
				lines: counterWrites(this.lines()),
				buyer: { phone: this.phone(), name: this.name(), address: this.address(), gstin: this.gstin() },
				expectedTotalINR: quote.totalINR,
			},
		};
		(popup.componentInstance as CounterPayment).start(start);
		const sold = (await popup.result.catch(() => null)) as CounterSaleDone | null;
		if (!sold) return;
		this.lines.set([]);
		this.phone.set('');
		this.name.set('');
		this.address.set('');
		this.gstin.set('');
		this.notifier.showSuccess(this.transloco.translate('counter_sold', { number: sold.invoiceNumber }));
		try {
			openPdf(await firstValueFrom(this.gateway.print(sold.orderId, sold.print)));
		} catch {
			// The sale stands; the invoice prints again from the order's Documents.
			this.notifier.showError(this.transloco.translate('counter_print_failed'));
		}
	}
}
