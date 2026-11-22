import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { injectQueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { ORDER_STATUS_PILL, money, shippingReason } from '@core/orders/order-format';
import { ORDERS_KEY, OrdersGateway, injectAdminOrderQuery } from '@core/orders/orders.gateway';
import { RupeesPipe, apiProblem, rupees, shortDate, shortDateTime } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { askConfirmComment, askReason } from '@features/purchasing/shared/popups';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import { OrderClosePopup, type CloseOutcome } from './order-close-popup';
import { OrderEDocPopup } from './order-edoc-popup';
import { INVOICE_CONFIRMED_HOW, OrderInvoiceAddressPopup } from './order-invoice-address-popup';
import { OrderPaymentPopup } from './order-payment-popup';
import { OrderRequestPopup } from './order-request-popup';
import { OrderSendPopup, type SendChannel, type SendOutcome } from './order-send-popup';
import { OrderStatusPopup } from './order-status-popup';

import type {
	AdminOrderDetail,
	Order,
	OrderAddress,
	OrderHistoryEntry,
	OrderLine,
	OrderPayment,
	PaymentRequest,
} from '@saha-textile/contracts';

/** The steps across the top of the order (od05): the theme's tracking icons, in the status machine's order. */
const STEPS: ReadonlyArray<{ status: Order['status']; icon: string }> = [
	{ status: 'awaiting_payment', icon: 'pending' },
	{ status: 'placed', icon: 'refund' },
	{ status: 'processing', icon: 'processing' },
	{ status: 'packed', icon: 'shipped' },
	{ status: 'shipped', icon: 'out-for-delivery' },
	{ status: 'delivered', icon: 'delivered' },
];
const STEP_AT: Partial<Record<Order['status'], number>> = {
	awaiting_payment: 0,
	placed: 1,
	processing: 2,
	packed: 3,
	shipped: 4,
	out_for_delivery: 4,
	delivered: 5,
};

/** "Moulik Patra" → "Moulik", as the brief's history and request lines write staff names. */
function firstName(name: string): string {
	return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * Admin › Orders › Order (brief od05–od08, pl01–pl05, st01–st05; owner 2026-11-16 to 2026-11-20):
 * the steps, the items, the shipping charge with its reason, payments and payment requests, the
 * e-invoice / e-way bill block, shipments, history, and the summary, buyer and rates on the right.
 * Every action goes through the API's status machine and permission checks; the page shows answers.
 */
@Component({
	selector: 'app-details',
	templateUrl: './details.html',
	styleUrls: ['./details.scss'],
	imports: [HasPermissionDirective, RouterModule, RupeesPipe, TranslocoModule],
})
export class Details {
	private readonly route = inject(ActivatedRoute);
	private readonly gateway = inject(OrdersGateway);
	private readonly modals = inject(NgbModal);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = injectQueryClient();
	private readonly t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);

	readonly id = toSignal(this.route.paramMap.pipe(map((params) => params.get('id'))), { initialValue: null });
	readonly query = injectAdminOrderQuery(() => this.id());
	readonly detail = computed<AdminOrderDetail | null>(() => this.query.data() ?? null);

	/** pl01–pl04: "Total due", or "Total paid · INR gateway" / "· PayPal" / "· UPI" once it is paid. */
	readonly totalWords = computed(() => {
		const detail = this.detail();
		if (!detail) return '';
		const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
		if (detail.order.paymentStatus !== 'paid') return t('ord_total_due');
		const last = [...detail.payments].reverse().find((payment) => payment.state === 'received');
		if (!last) return t('ord_total');
		const via =
			last.method === 'gateway'
				? t(last.gateway?.id === 'paypal' ? 'ord_via_paypal' : 'ord_via_inr_gateway')
				: t(`ord_via_${last.method}`);
		return t('ord_total_paid_via', { via });
	});
	readonly order = computed<Order | null>(() => this.detail()?.order ?? null);
	readonly busy = signal<string | null>(null);

	readonly steps = STEPS;
	readonly stepAt = computed(() => {
		const order = this.order();
		return order ? (STEP_AT[order.status] ?? -1) : -1;
	});
	readonly statusPill = computed(() => {
		const order = this.order();
		return order ? ORDER_STATUS_PILL[order.status] : 'pending';
	});
	readonly foreign = computed(() => (this.order()?.currency ?? 'INR') !== 'INR');
	readonly requests = computed(() => [...(this.detail()?.requests ?? [])].reverse());
	readonly history = computed(() => [...(this.order()?.history ?? [])].reverse());
	readonly paypalRecord = computed(() => this.detail()?.payments.find((payment) => payment.paypal)?.paypal ?? null);
	readonly needsInvoiceAddress = computed(() => !!this.detail()?.attention.includes('invoiceAddressNeeded'));

	/**
	 * Staff first names ("by Moulik", "Moulik, in the admin"): the names the server looks up for this
	 * order's staff, then any name a history line kept itself.
	 */
	readonly staffNames = computed(() => {
		const names = new Map<string, string>();
		for (const [id, name] of Object.entries(this.detail()?.staff ?? {})) names.set(id, firstName(name));
		for (const entry of this.order()?.history ?? []) {
			if (entry.by && entry.byName && !names.has(entry.by)) names.set(entry.by, firstName(entry.byName));
		}
		return names;
	});
	/** od05: "2 discounted pieces × ₹100; the full-price piece ships free." from the kept explanation. */
	readonly shipReason = computed(() => {
		const ship = this.order()?.shipping;
		if (!ship || ship.pending) return '';
		const { reason } = shippingReason({ trace: ship.trace, pieces: ship.pieces }, this.t);
		return this.transloco.getActiveLang() === 'en' && reason
			? reason.charAt(0).toLowerCase() + reason.slice(1)
			: reason;
	});
	/** When the order was priced (its rate, or its creation). */
	readonly pricedAt = computed(() => this.order()?.currencyRecord?.pricedAt ?? this.order()?.createdAt ?? null);
	/** The request that is still waiting, for "Paid another way? Record it here" (pl01). */
	readonly activeRequest = computed(() => this.requests().find((request) => request.status === 'active') ?? null);
	/** od08: a cash-on-delivery order shows what is due before anything is collected. */
	readonly codDue = computed(() => {
		const detail = this.detail();
		if (!detail || detail.order.paymentStatus !== 'due_on_delivery') return null;
		if (detail.payments.some((payment) => payment.method === 'cashOnDelivery' && payment.state === 'received'))
			return null;
		return { amountINR: detail.order.balance?.dueINR ?? detail.order.totalINR, by: this.createdByName() };
	});
	readonly createdByName = computed(() => {
		const order = this.order();
		return order?.createdBy ? (this.staffNames().get(order.createdBy) ?? null) : null;
	});
	/** History rows as od05/od06 draw them; a payment that placed the order shares one row with Placed. */
	readonly historyRows = computed(() => {
		const order = this.order();
		if (!order) return [];
		const entries = order.history;
		const rows: Array<ReturnType<Details['historyLine']>> = [];
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index] as OrderHistoryEntry;
			const next = entries[index + 1];
			const line = this.historyLine(entry);
			if (entry.kind === 'payment' && next?.kind === 'status' && next.to === 'placed' && next.at === entry.at) {
				// "Paid ₹23,050 through the INR gateway · Placed" (od05): one row for the payment and the step it caused.
				rows.push({ ...line, placed: true, messages: [...entry.messages, ...next.messages] });
				index += 1;
				continue;
			}
			rows.push(line);
		}
		return rows.reverse();
	});

	/* ------------------------------------------------------------------ formatting */

	money(amount: number | null | undefined): string {
		const order = this.order();
		if (amount === null || amount === undefined || !order) return '—';
		return money(amount, order.currency, this.locale());
	}

	moneyIn(amount: number, currency: string): string {
		return money(amount, currency, this.locale());
	}

	rupees(amount: number | null | undefined): string {
		return rupees(amount);
	}

	day(value: string | null | undefined): string {
		return shortDate(value);
	}

	when(value: string | null | undefined): string {
		return shortDateTime(value);
	}

	address(address: OrderAddress | null | undefined): string {
		if (!address) return '—';
		const parts = [
			address.line1,
			address.line2,
			address.landmark,
			address.city,
			address.state,
			address.postalCode,
			this.country(address.countryCode ?? address.country),
		];
		return parts.filter((part) => !!part && String(part).trim()).join(', ');
	}

	phone(address: OrderAddress | null | undefined): string {
		const mobile = address?.mobile;
		return mobile ? `+${mobile.countryCallingCode} ${mobile.number}` : '';
	}

	country(code: string | null | undefined): string {
		if (!code) return '';
		try {
			return new Intl.DisplayNames([this.locale()], { type: 'region' }).of(code.toUpperCase()) ?? code;
		} catch {
			return code;
		}
	}

	paymentPill(payment: OrderPayment): string {
		if (payment.state === 'received') return 'success';
		if (payment.state === 'pending') return 'pending';
		if (payment.state === 'refunded' || payment.state === 'partRefunded') return 'refund';
		return 'failed';
	}

	requestPill(request: PaymentRequest): string {
		if (request.status === 'paid') return 'success';
		if (request.status === 'active') return 'pending';
		if (request.status === 'expired' || request.status === 'failed') return 'failed';
		return 'cancelled';
	}

	/** One history row: a bold lead (a status), the words around it, the comment, who, and what the customer was told. */
	historyLine(entry: OrderHistoryEntry): {
		at: string;
		lead: string | null;
		text: string;
		comment: string | null;
		by: string;
		messages: OrderHistoryEntry['messages'];
		placed?: boolean;
	} {
		const t = this.t;
		const detail = entry.detail ?? {};
		const str = (key: string) => (typeof detail[key] === 'string' ? (detail[key] as string) : null);
		const num = (key: string) => (typeof detail[key] === 'number' ? (detail[key] as number) : null);
		let lead: string | null = null;
		let text = '';
		let comment = entry.comment ? this.historyComment(entry) : null;
		if (entry.kind === 'status' && entry.to) {
			lead = t(`ord_status_${entry.to}`);
			const parts: string[] = [];
			if (str('courier')) parts.push([str('courier'), str('tracking')].filter(Boolean).join(' '));
			if (str('proof')) parts.push(t('ord_hist_proof', { proof: str('proof') }));
			text = parts.join(' · ');
		} else if (entry.kind === 'created' && str('items')) {
			text = t(str('method') === 'keepOpen' ? 'ord_hist_opened' : 'ord_hist_created_items', {
				items: str('items'),
			});
		} else if (entry.kind === 'lineAdded' && str('items')) {
			text = t('ord_hist_added', { items: str('items') });
		} else if (entry.kind === 'lineRemoved' && str('title')) {
			const count = num('quantity') ?? 1;
			text = t(
				count === 1 ? 'ord_hist_removed_one' : count === 2 ? 'ord_hist_removed_two' : 'ord_hist_removed_other',
				{
					count,
					title: str('title'),
					amount: rupees(num('amountINR') ?? 0),
				},
			);
		} else if (entry.kind === 'comment') {
			text = t('ord_hist_comment', { comment: entry.comment ?? '' });
			comment = null;
		} else if (entry.kind === 'payment' && (str('gateway') || num('amountINR') !== null)) {
			const gateway = str('gateway');
			const method = str('method');
			const amount = num('amountINR');
			if (gateway && amount !== null) {
				const via = t(`ord_req_gateway_${gateway}`);
				const requestAt = str('requestAt');
				text = requestAt
					? t('ord_hist_paid_request', { amount: rupees(amount), via, date: this.day(requestAt) })
					: t('ord_hist_paid_via', { amount: rupees(amount), via });
			} else if (amount !== null) {
				text = t('ord_hist_payment_recorded', {
					amount: rupees(amount),
					method: method ? t(`ord_method_${method}`) : '',
				});
			} else {
				text = t('ord_history_payment');
			}
		} else {
			text = t(`ord_history_${entry.kind}`);
		}
		const order = this.order();
		const by =
			(entry.by ? this.staffNames().get(entry.by) : undefined) ??
			(entry.byName ? firstName(entry.byName) : t(order?.channel === 'shop' ? 'ord_by_shop' : 'ord_by_system'));
		return { at: entry.at, lead, text, comment, by, messages: entry.messages };
	}

	/* ------------------------------------------------------------------ payment requests (pl01–pl05) */

	requestGateway(request: PaymentRequest): string {
		return this.t(`ord_req_gateway_${request.gateway}`);
	}

	requestSentWords(request: PaymentRequest): string {
		return this.t(`ord_req_sent_${request.gateway}`, { at: this.when(request.createdAt) });
	}

	requestedLine(request: PaymentRequest): string {
		const amount =
			request.currency === 'INR' ? rupees(request.amountINR) : this.moneyIn(request.amount, request.currency);
		const { email, mobile } = request.sentTo;
		const to = email && mobile ? this.t('ord_req_to_both', { email, mobile }) : (email ?? mobile ?? '—');
		const by = this.staffNames().get(request.createdBy) ?? this.t('ord_by_system');
		return this.t('ord_req_requested_line', { amount, to, by });
	}

	validLine(request: PaymentRequest): string {
		const date = this.when(request.expiresAt);
		if (request.status === 'expired') return this.t('ord_req_valid_expired', { date });
		if (request.currency !== 'INR') return this.t('ord_req_valid_fixed', { date });
		const count = this.heldPieces();
		if (!count) return date;
		return this.t(count === 1 ? 'ord_req_valid_held_one' : 'ord_req_valid_held_other', { date, count });
	}

	/** pl02: "1 failed at 15:05 (card declined) · 1 paid at 15:09 (UPI)". */
	attemptsSummary(request: PaymentRequest): string {
		return request.attempts
			.map((attempt) => {
				const base = this.t(`ord_req_attempt_n_${attempt.state}`, { count: 1, time: this.time(attempt.at) });
				const why =
					attempt.state === 'failed'
						? attempt.method
							? this.t('ord_req_declined_method', { method: attempt.method })
							: this.t('ord_req_declined')
						: attempt.method;
				return why ? `${base} (${why})` : base;
			})
			.join(' · ');
	}

	paidAttempt(request: PaymentRequest) {
		return [...request.attempts].reverse().find((attempt) => attempt.state === 'captured') ?? null;
	}

	hasPendingAttempt(request: PaymentRequest): boolean {
		return request.attempts.some((attempt) => attempt.state === 'pending');
	}

	/** pl03: "Checked · just now with the INR gateway". */
	checkedLine(request: PaymentRequest): string | null {
		if (!request.lastCheckedAt) return null;
		const gateway = this.requestGateway(request);
		const ago = Date.now() - new Date(request.lastCheckedAt).getTime();
		return ago < 120_000
			? this.t('ord_req_checked_just_now', { gateway })
			: this.t('ord_req_checked_at', { time: this.when(request.lastCheckedAt), gateway });
	}

	smsReachable(request: PaymentRequest): boolean {
		const mobile = (request.sentTo.mobile ?? '').replace(/[\s-]/g, '');
		return /^(\+?91)?[6-9]\d{9}$/.test(mobile);
	}

	/* ------------------------------------------------------------------ payments table (pl02, pl04, od08) */

	paymentMethodWords(payment: OrderPayment): string {
		if (payment.method === 'gateway' && payment.gateway) {
			const gateway = this.t(`ord_gateway_${payment.gateway.id}`);
			return this.t(payment.gateway.requestId ? 'ord_pay_method_link' : 'ord_pay_method_shop', { gateway });
		}
		return this.t(`ord_method_${payment.method}`);
	}

	recordedBy(payment: OrderPayment): string {
		if (payment.gateway) return payment.gateway.id === 'paypal' ? 'PayPal' : this.t('ord_recorded_by_gateway');
		return (payment.recordedBy && this.staffNames().get(payment.recordedBy)) || '—';
	}

	receivedWhen(payment: OrderPayment): string {
		if (payment.gateway) return this.when(payment.recordedAt);
		return payment.receivedOn ? this.day(payment.receivedOn) : '—';
	}

	/* ------------------------------------------------------------------ items, buyer */

	/** od05: "ST-SLK-0118 · MRP ₹9,800 · ₹8,900", or the price alone. */
	linePrice(line: OrderLine): string {
		const price = this.money(line.unitPricePaid);
		const mrp = line.pricing?.mrpUnitINR;
		return mrp && mrp > line.unitPriceINR ? this.t('ord_line_mrp_price', { mrp: rupees(mrp), price }) : price;
	}

	buyerPhone(): string {
		const mobile = this.order()?.buyer?.mobile;
		if (!mobile) return '';
		const digits = mobile.number.replace(/\D/g, '');
		const spaced =
			mobile.countryCallingCode === '91' && digits.length === 10
				? `${digits.slice(0, 5)} ${digits.slice(5)}`
				: digits;
		return `+${mobile.countryCallingCode} ${spaced}`;
	}

	time(value: string | null | undefined): string {
		if (!value) return '';
		return new Date(value).toLocaleTimeString('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Asia/Kolkata',
		});
	}

	/** The history comment; how an invoice address was confirmed is a code shown in the page's language. */
	historyComment(entry: OrderHistoryEntry): string {
		const comment = entry.comment ?? '';
		if (entry.kind === 'invoiceAddress' && (INVOICE_CONFIRMED_HOW as readonly string[]).includes(comment)) {
			return this.transloco.translate(`ord_confirmed_${comment}`);
		}
		return comment;
	}

	private locale(): string {
		return this.transloco.getActiveLang() === 'bn' ? 'bn-IN' : 'en-IN';
	}

	/* ------------------------------------------------------------------ actions */

	async updateStatus(): Promise<void> {
		const detail = this.detail();
		if (!detail) return;
		const popup = this.modals.open(OrderStatusPopup, {
			centered: true,
			size: 'lg',
			windowClass: 'theme-modal',
			ariaLabelledBy: 'order_status_popup_title',
		});
		(popup.componentInstance as OrderStatusPopup).start(detail);
		if (await popup.result.catch(() => null)) await this.refresh('ord_status_saved');
	}

	async addComment(): Promise<void> {
		const order = this.order();
		if (!order) return;
		const done = await askReason(this.modals, {
			title: 'ord_add_comment',
			label: 'ord_comment',
			help: 'ord_comment_help',
			confirm: 'ord_add_comment',
			act: (comment) => firstValueFrom(this.gateway.comment(order.id, { comment, revision: order.revision })),
		});
		if (done) await this.refresh('ord_comment_saved');
	}

	async recordPayment(): Promise<void> {
		const order = this.order();
		if (!order) return;
		const popup = this.modals.open(OrderPaymentPopup, {
			centered: true,
			windowClass: 'theme-modal',
			ariaLabelledBy: 'order_payment_popup_title',
		});
		await (popup.componentInstance as OrderPaymentPopup).start(order);
		if (await popup.result.catch(() => null)) await this.refresh('ord_payment_saved');
	}

	/** Request online payment (oo07), or again after an expired or cancelled request (pl05). */
	async requestPayment(previous: PaymentRequest | null = null): Promise<void> {
		const order = this.order();
		if (!order) return;
		const popup = this.modals.open(OrderRequestPopup, {
			centered: true,
			size: 'lg',
			windowClass: 'theme-modal',
			ariaLabelledBy: 'order_request_popup_title',
		});
		await (popup.componentInstance as OrderRequestPopup).start(order, previous, this.heldPieces());
		if (await popup.result.catch(() => null)) await this.refresh('ord_request_sent_toast');
	}

	/** The latest request, when it ended unpaid and nothing newer is waiting (pl05). */
	readonly lapsedRequest = computed(() => {
		const latest = this.requests()[0];
		return latest && (latest.status === 'expired' || latest.status === 'cancelled') ? latest : null;
	});

	/** oo02: "Open order since 4 Sep (77 days)". */
	readonly openDays = computed(() => {
		const opened = this.order()?.openedAt;
		return opened ? Math.max(0, Math.floor((Date.now() - new Date(opened).getTime()) / 86_400_000)) : 0;
	});
	readonly buyerFirstName = computed(() => firstName(this.order()?.buyer?.name ?? ''));
	/** "Paid (4 payments)": the payments that came in. */
	readonly receivedCount = computed(
		() => (this.detail()?.payments ?? []).filter((payment) => payment.state === 'received').length,
	);

	/* ------------------------------------------------- sets, free items and the Pack list (brief E07–E08) */

	/** The lines a line holds: a set's pieces and extras, a piece's or a product's free items. */
	childrenOf(line: OrderLine): OrderLine[] {
		return (this.order()?.lines ?? []).filter((row) => row.parentLineId && row.parentLineId === line.lineId);
	}

	private lineById(id: string | null): OrderLine | undefined {
		return id ? this.order()?.lines.find((row) => row.lineId === id) : undefined;
	}

	/** 2 for a free item under a set's piece, 1 for other children, 0 for a line of its own. */
	depthOf(line: OrderLine): number {
		if (!line.parentLineId) return 0;
		return this.lineById(line.parentLineId)?.parentLineId ? 2 : 1;
	}

	/** A piece's number in its set. */
	pieceNumber(line: OrderLine): number {
		const parent = this.lineById(line.parentLineId);
		return parent
			? this.childrenOf(parent)
					.filter((row) => row.role === 'piece')
					.indexOf(line) + 1
			: 0;
	}

	/** A set's line shows what its children cost together (its own line holds no money). */
	setTotalPaid(line: OrderLine): number {
		return this.childrenOf(line).reduce((sum, row) => sum + row.lineTotalPaid, 0);
	}

	/** "3 pieces + 1 extra" under a set's name. */
	setCounts(line: OrderLine): string {
		const children = this.childrenOf(line);
		const pieces = children.filter((row) => row.role === 'piece').length;
		const extras = children.filter((row) => row.role === 'extra').length;
		const words = this.t(pieces === 1 ? 'ord_set_pieces_one' : 'ord_set_pieces', { count: pieces });
		return extras ? `${words} ${this.t('ord_set_extras', { count: extras })}` : words;
	}

	/** A child's size or colour, as the order kept it. */
	attributeValues(line: OrderLine): string[] {
		return Object.values(line.attributes ?? {});
	}

	freeCount(line: OrderLine): number {
		return this.childrenOf(line).filter((row) => row.role === 'free').length;
	}

	/** Lines of their own (a product or a set), numbered as the Pack list names them. */
	private readonly topLines = computed(() => (this.order()?.lines ?? []).filter((line) => !line.parentLineId));

	/** Every physical piece in the parcel, flat, with where it comes from (E08). */
	readonly packRows = computed(() => {
		const order = this.order();
		if (!order) return [];
		const tops = this.topLines();
		const lineNo = (line: OrderLine | undefined) => (line ? tops.indexOf(line) + 1 : 0);
		const setName = (line: OrderLine | undefined) => line?.title.en ?? '';
		return order.lines
			.filter((line) => line.role !== 'bundle')
			.map((line) => {
				const parent = this.lineById(line.parentLineId);
				// The words are looked up in the template, so they follow the language once it has loaded.
				let from: { key: string; params: Record<string, unknown> };
				if (!parent) from = { key: 'ord_pack_from_line', params: { n: lineNo(line) } };
				else if (line.role === 'piece') {
					from = { key: 'ord_pack_from_piece', params: { set: setName(parent), n: this.pieceNumber(line) } };
				} else if (line.role === 'extra')
					from = { key: 'ord_pack_from_extra', params: { set: setName(parent) } };
				else if (parent.role === 'piece') {
					from = {
						key: 'ord_pack_from_free_piece',
						params: { n: this.pieceNumber(parent), set: setName(this.lineById(parent.parentLineId)) },
					};
				} else from = { key: 'ord_pack_from_free_line', params: { n: lineNo(parent) } };
				// Lines without options may come without these fields; a missing one must never stop the page.
				const options = [
					...Object.values(line.attributes ?? {}),
					...(line.addons ?? []).map((addon) => `${addon.label ?? addon.code}: ${addon.value}`),
				].join(' · ');
				return { line, from, options, ticked: (order.packTicks ?? []).includes(line.lineId ?? '') };
			});
	});
	/** The Pack list shows while the order is being packed. */
	readonly packing = computed(() => ['placed', 'processing'].includes(this.order()?.status ?? ''));
	readonly packTicked = computed(() => this.packRows().filter((row) => row.ticked).length);
	readonly packPieces = computed(() => this.packRows().reduce((sum, row) => sum + row.line.quantity, 0));
	/** Mark packed opens once every piece is ticked (the server checks it again). */
	readonly packDone = computed(() => this.packRows().every((row) => row.ticked));

	async tick(line: OrderLine, ticked: boolean): Promise<void> {
		const order = this.order();
		if (!order || !line.lineId) return;
		await this.run(`pack:${line.lineId}`, async () => {
			await firstValueFrom(
				this.gateway.packTick(order.id, { lineId: line.lineId as string, ticked, revision: order.revision }),
			);
			await this.queryClient.invalidateQueries({ queryKey: [...ORDERS_KEY] });
		});
	}

	/** Print pack list: the packing slip (every piece flat, a tick box each, no prices) opens as a PDF. */
	async printPackList(): Promise<void> {
		const order = this.order();
		if (!order) return;
		await this.run('print-pack', async () => {
			const blob = await firstValueFrom(this.gateway.packingSlip(order.id));
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank', 'noopener');
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
		});
	}

	async markPacked(): Promise<void> {
		const order = this.order();
		if (!order) return;
		await this.run('packed', async () => {
			await firstValueFrom(
				this.gateway.changeStatus(order.id, {
					to: 'packed',
					comment: null,
					shipped: null,
					delivered: null,
					cancel: null,
					lineIds: [],
					revision: order.revision,
				}),
			);
			await this.refresh('ord_status_saved');
		});
	}

	readonly heldPieces = computed(() =>
		(this.order()?.lines ?? []).reduce((sum, line) => sum + (line.held ? line.quantity : 0), 0),
	);

	async addInvoiceAddress(): Promise<void> {
		const order = this.order();
		if (!order) return;
		const popup = this.modals.open(OrderInvoiceAddressPopup, {
			centered: true,
			size: 'lg',
			windowClass: 'theme-modal',
			ariaLabelledBy: 'order_invoice_address_popup_title',
		});
		(popup.componentInstance as OrderInvoiceAddressPopup).start(order);
		if (await popup.result.catch(() => null)) await this.refresh('ord_invoice_address_saved');
	}

	/** ✕ on a held line of an open order (oo06): says what happens to the balance before it goes. */
	async removeLine(line: OrderLine): Promise<void> {
		const order = this.order();
		if (!order || !line.lineId) return;
		const balance = order.balance;
		const goodsAfter = Math.max(0, (balance?.goodsINR ?? 0) - line.lineTotalINR);
		const dueAfter = Math.max(
			0,
			goodsAfter + (balance?.shippingINR ?? 0) - (balance?.couponINR ?? 0) - (balance?.paidINR ?? 0),
		);
		const answer = await askConfirmComment(this.modals, {
			icon: 'ri-close-circle-line',
			title: 'ord_remove_line_title',
			body: 'ord_remove_line_body',
			params: {
				count: line.quantity,
				title: line.title.en,
				drop: rupees(line.lineTotalINR),
				goods: rupees(goodsAfter),
			},
			items: [
				this.transloco.translate('ord_remove_line_paid', {
					paid: rupees(balance?.paidINR ?? 0),
					due: rupees(dueAfter),
				}),
			],
			yes: line.quantity === 1 ? 'ord_remove_line_yes_one' : 'ord_remove_line_yes',
			cancel: line.quantity === 1 ? 'ord_remove_line_keep_one' : 'ord_remove_line_keep',
			danger: true,
			comment: { label: 'ord_comment_optional', placeholder: 'ord_remove_line_placeholder' },
		});
		if (!answer) return;
		await this.run(`remove:${line.lineId}`, async () => {
			await firstValueFrom(
				this.gateway.removeOpenLine(order.id, {
					lineId: line.lineId as string,
					reason: answer.comment || null,
					revision: order.revision,
				}),
			);
			await this.refresh('ord_line_removed');
		});
	}

	/** Close the open order (oo08); "Request online now" goes straight on to the request popup. */
	async closeOrder(): Promise<void> {
		const order = this.order();
		if (!order) return;
		const popup = this.modals.open(OrderClosePopup, {
			centered: true,
			windowClass: 'theme-modal',
			ariaLabelledBy: 'order_close_popup_title',
		});
		await (popup.componentInstance as OrderClosePopup).start(order);
		const outcome = (await popup.result.catch(() => null)) as CloseOutcome | null;
		if (!outcome) return;
		await this.refresh('ord_order_closed');
		if (outcome.then === 'requestOnline' && outcome.dueINR > 0) {
			const fresh = await this.query.refetch();
			if (fresh.data) await this.requestPayment(null);
		}
	}

	async markReceived(payment: OrderPayment): Promise<void> {
		const order = this.order();
		if (!order) return;
		const done = await askReason(this.modals, {
			title: 'ord_mark_received',
			body: 'ord_mark_received_body',
			params: { amount: rupees(payment.amountINR) },
			label: 'ord_utr',
			confirm: 'ord_mark_received',
			act: (reference) =>
				firstValueFrom(
					this.gateway.markReceived(order.id, payment.id, {
						reference,
						receivedOn: new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10),
						revision: order.revision,
					}),
				),
		});
		if (done) await this.refresh('ord_payment_saved');
	}

	async checkRequest(request: PaymentRequest): Promise<void> {
		const order = this.order();
		if (!order) return;
		await this.run(`check:${request.id}`, async () => {
			const result = await firstValueFrom(this.gateway.checkRequest(order.id, request.id));
			if (result.recorded && result.payment) {
				// pl02: "Payment received: ₹15,800 through the INR gateway, reference 313012345678. …"
				await this.queryClient.invalidateQueries({ queryKey: [...ORDERS_KEY] });
				this.notifier.showSuccess(
					this.t('ord_request_paid_detail_toast', {
						amount: rupees(result.payment.amountINR),
						gateway: this.requestGateway(request),
						reference: result.payment.reference ?? '—',
					}),
				);
				return;
			}
			await this.refresh(result.recorded ? 'ord_request_paid_toast' : 'ord_request_not_paid');
		});
	}

	/** Send as SMS / Send as email (pr01, pr02): the exact message first, sent only when pressed. */
	async sendMessage(request: PaymentRequest, channel: SendChannel): Promise<void> {
		const order = this.order();
		if (!order) return;
		const popup = this.modals.open(OrderSendPopup, {
			centered: true,
			windowClass: 'theme-modal',
			ariaLabelledBy: 'order_send_popup_title',
		});
		void (popup.componentInstance as OrderSendPopup).start(order, request, channel);
		const outcome = (await popup.result.catch(() => null)) as SendOutcome | null;
		if (!outcome) return;
		await this.queryClient.invalidateQueries({ queryKey: [...ORDERS_KEY] });
		if (outcome.status === 'sent' || outcome.status === 'delivered') {
			this.notifier.showSuccess(this.t('ord_send_result_sent'));
		} else if (outcome.status === 'queued') {
			this.notifier.showSuccess(this.t('ord_send_result_queued'));
		} else {
			this.notifier.showError(
				this.t('ord_send_result_not_sent', { why: this.t(`ord_send_why_${outcome.status}`) }),
			);
		}
	}

	async cancelRequest(request: PaymentRequest): Promise<void> {
		const order = this.order();
		if (!order) return;
		await this.run(`cancel:${request.id}`, async () => {
			await firstValueFrom(this.gateway.cancelRequest(order.id, request.id));
			await this.refresh('ord_request_cancelled_toast');
		});
	}

	async copy(text: string | null): Promise<void> {
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			this.notifier.showSuccess(this.transloco.translate('ord_link_copied'));
		} catch {
			this.notifier.showError(this.transloco.translate('ord_copy_failed'));
		}
	}

	async eDocument(kind: 'eInvoice' | 'eWayBill'): Promise<void> {
		const order = this.order();
		if (!order) return;
		await this.run(`raise:${kind}`, async () => {
			const raised = await firstValueFrom(
				kind === 'eInvoice' ? this.gateway.raiseEInvoice(order.id) : this.gateway.raiseEWayBill(order.id),
			);
			if (raised.outcome === 'raised') {
				await this.refresh('ord_edoc_saved');
				return;
			}
			// No integration yet: the details are typed in by hand (owner, 2026-11-20).
			const popup = this.modals.open(OrderEDocPopup, {
				centered: true,
				size: 'lg',
				windowClass: 'theme-modal',
				ariaLabelledBy: 'order_edoc_popup_title',
			});
			(popup.componentInstance as OrderEDocPopup).start(order, kind);
			if (await popup.result.catch(() => null)) await this.refresh('ord_edoc_saved');
		});
	}

	private async run(key: string, work: () => Promise<void>): Promise<void> {
		this.busy.set(key);
		try {
			await work();
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.busy.set(null);
		}
	}

	private async refresh(message: string): Promise<void> {
		await this.queryClient.invalidateQueries({ queryKey: [...ORDERS_KEY] });
		this.notifier.showSuccess(this.transloco.translate(message));
	}
}
