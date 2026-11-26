import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InvoicesGateway } from '@core/accounts/invoices.gateway';
import { OrdersGateway } from '@core/orders/orders.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { Details } from './details';

import type { AdminOrderDetail, OrderLine, PaymentRequest } from '@saha-textile/contracts';

const h = vi.hoisted(() => ({
	reason: 'Called the buyer' as unknown,
	comment: null as unknown,
	invalidate: vi.fn(async () => undefined),
	refetch: vi.fn(async () => ({ data: undefined as unknown })),
}));
const data = signal<AdminOrderDetail | undefined>(undefined);
vi.mock('@core/orders/orders.gateway', async (original) => ({
	...(await original<typeof import('@core/orders/orders.gateway')>()),
	injectAdminOrderQuery: (id: () => string | null) => (
		id(),
		{ data, isPending: () => false, isError: () => false, refetch: h.refetch }
	),
}));
vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<typeof import('@tanstack/angular-query-experimental')>()),
	injectQueryClient: () => ({ invalidateQueries: h.invalidate }),
}));
vi.mock('@features/purchasing/shared/popups', () => ({
	askReason: async (_modals: unknown, options: { act: (reason: string) => Promise<unknown> }) =>
		typeof h.reason === 'string' ? options.act(h.reason) : h.reason,
	askConfirmComment: async () => h.comment,
}));

const t = (key: string, params?: Record<string, unknown>) =>
	params && Object.keys(params).length ? `${key}(${Object.values(params).join('|')})` : key;

const line = (over: Partial<OrderLine> = {}): OrderLine =>
	({
		lineId: 'l1',
		parentLineId: null,
		role: 'product',
		title: { en: 'Silk' },
		quantity: 1,
		held: false,
		lineTotalINR: 1000,
		lineTotalPaid: 1000,
		unitPriceINR: 1000,
		unitPricePaid: 1000,
		...over,
	}) as unknown as OrderLine;

const detail = (order: Record<string, unknown> = {}, over: Record<string, unknown> = {}): AdminOrderDetail =>
	({
		order: {
			id: 'ord_1',
			orderNumber: 'ST-1',
			currency: 'INR',
			status: 'processing',
			revision: 4,
			channel: 'admin',
			lines: [],
			history: [],
			totalINR: 2000,
			paymentStatus: 'due',
			createdAt: '2026-11-19T10:00:00.000Z',
			...order,
		},
		payments: [],
		requests: [],
		shipments: [],
		allowedNext: [],
		attention: [],
		credit: null,
		staff: {},
		eDocuments: { shown: false },
		...over,
	}) as unknown as AdminOrderDetail;

const request = (over: Record<string, unknown> = {}): PaymentRequest =>
	({
		id: 'req_1',
		gateway: 'ccavenue',
		status: 'active',
		currency: 'INR',
		amount: 1200,
		amountINR: 1200,
		createdAt: '2026-11-19T10:00:00.000Z',
		expiresAt: '2026-11-26T10:00:00.000Z',
		createdBy: 'adm_1',
		sentTo: { email: null, mobile: null },
		attempts: [],
		lastCheckedAt: null,
		...over,
	}) as unknown as PaymentRequest;

function render(options: { lang?: string; popups?: unknown[] } = {}) {
	const answers = [...(options.popups ?? [])];
	const instance = { start: vi.fn(async () => undefined) };
	const modals = {
		open: vi.fn(() => {
			const answer = answers.length > 1 ? answers.shift() : answers[0];
			const result = answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
			result.catch(() => undefined);
			return { componentInstance: instance, result };
		}),
	};
	const gateway = {
		comment: vi.fn(() => of({})),
		checkRequest: vi.fn(() => of({ recorded: false })),
		packTick: vi.fn(() => of({})),
		packingSlip: vi.fn(() => of(new Blob(['%PDF']))),
		receiptPdf: vi.fn(() => of(new Blob(['%PDF']))),
		changeStatus: vi.fn(() => of({})),
		removeOpenLine: vi.fn(() => of({})),
		markReceived: vi.fn(() => of({})),
		cancelRequest: vi.fn(() => of({})),
		raiseEInvoice: vi.fn(() => of({ outcome: 'raised' })),
		raiseEWayBill: vi.fn(() => of({ outcome: 'manual' })),
	};
	const invoices = { forOrder: vi.fn(() => of([])) };
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: OrdersGateway, useValue: gateway },
			{ provide: InvoicesGateway, useValue: invoices },
			{ provide: NotificationService, useValue: notifier },
			{ provide: NgbModal, useValue: modals },
			{ provide: TranslocoService, useValue: { translate: t, getActiveLang: () => options.lang ?? 'en' } },
			{
				provide: ActivatedRoute,
				useValue: { paramMap: new BehaviorSubject(convertToParamMap({ id: 'ord_1' })) },
			},
		],
	});
	TestBed.overrideComponent(Details, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(Details);
	fixture.detectChanges();
	return { page: fixture.componentInstance, gateway, invoices, notifier, modals, instance };
}

const urls = URL as unknown as Record<string, unknown>;
beforeEach(() => {
	urls['createObjectURL'] = vi.fn(() => 'blob:1');
	urls['revokeObjectURL'] = vi.fn();
});
afterEach(() => {
	data.set(undefined);
	h.reason = 'Called the buyer';
	h.comment = null;
	h.invalidate.mockClear();
	h.refetch.mockReset();
	delete urls['createObjectURL'];
	delete urls['revokeObjectURL'];
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('the order page before its order loads', () => {
	it('reads empty, and every action waits for the order', async () => {
		const { page, modals, gateway } = render();
		expect([page.totalWords(), page.stepAt(), page.statusPill(), page.foreign()]).toEqual([
			'',
			-1,
			'pending',
			false,
		]);
		expect([page.requests(), page.history(), page.historyRows(), page.packRows()]).toEqual([[], [], [], []]);
		expect([page.paypalRecord(), page.shipReason(), page.pricedAt(), page.activeRequest(), page.codDue()]).toEqual([
			null,
			'',
			null,
			null,
			null,
		]);
		expect([page.createdByName(), page.lapsedRequest(), page.openDays(), page.buyerFirstName()]).toEqual([
			null,
			null,
			0,
			'',
		]);
		expect([page.receivedCount(), page.heldPieces(), page.packing(), page.money(10)]).toEqual([0, 0, false, '—']);
		expect(page.childrenOf(line())).toEqual([]);
		expect(page.staffNames().size).toBe(0);
		for (const action of [
			() => page.updateStatus(),
			() => page.addComment(),
			() => page.recordPayment(),
			() => page.requestPayment(),
			() => page.tick(line(), true),
			() => page.printPackList(),
			() => page.printReceipt('p1'),
			() => page.markPacked(),
			() => page.addInvoiceAddress(),
			() => page.removeLine(line()),
			() => page.closeOrder(),
			() => page.markReceived({ id: 'p1', amountINR: 1 } as never),
			() => page.checkRequest(request()),
			() => page.sendMessage(request(), 'sms'),
			() => page.cancelRequest(request()),
			() => page.eDocument('eInvoice'),
		])
			await action();
		expect(modals.open).not.toHaveBeenCalled();
		expect(Object.values(gateway).every((call) => call.mock.calls.length === 0)).toBe(true);
	});
});

describe('the order page: words', () => {
	it('words the total: due, paid with nothing received, through a gateway or PayPal, or a method', () => {
		data.set(detail({ paymentStatus: 'paid' }));
		const { page } = render();
		expect(page.totalWords()).toBe('ord_total');
		data.set(
			detail(
				{ paymentStatus: 'paid' },
				{ payments: [{ state: 'received', method: 'gateway', gateway: { id: 'paypal' } }] },
			),
		);
		expect(page.totalWords()).toBe('ord_total_paid_via(ord_via_paypal)');
		data.set(
			detail({ paymentStatus: 'paid' }, { payments: [{ state: 'received', method: 'gateway', gateway: null }] }),
		);
		expect(page.totalWords()).toBe('ord_total_paid_via(ord_via_inr_gateway)');
		data.set(detail({ paymentStatus: 'paid' }, { payments: [{ state: 'received', method: 'upi' }] }));
		expect(page.totalWords()).toBe('ord_total_paid_via(ord_via_upi)');
	});

	it('words the shipping reason in each language, and none while it is still being worked out', () => {
		const trace = [JSON.stringify({ result: 'free', lineIds: ['a'], units: 1 })];
		data.set(detail({ shipping: { pending: true, trace, pieces: [] } }));
		const { page } = render();
		expect(page.shipReason()).toBe('');
		data.set(detail({ shipping: { pending: false, trace, pieces: [] } }));
		expect(page.shipReason()).toBe('ord_ship_more_free(1)');
		const bn = render({ lang: 'bn' });
		expect(bn.page.shipReason()).toBe('Ord_ship_more_free(1)');
		data.set(detail({ shipping: { pending: false, trace: [], pieces: [] } }));
		expect(bn.page.shipReason()).toBe('');
	});

	it('cash on delivery: what is due, by whom, and nothing once collected', () => {
		data.set(
			detail(
				{ paymentStatus: 'due_on_delivery', createdBy: 'adm_1', balance: { dueINR: 900 } },
				{ staff: { adm_1: 'Moulik Patra' } },
			),
		);
		const { page } = render();
		expect(page.codDue()).toEqual({ amountINR: 900, by: 'Moulik' });
		data.set(detail({ paymentStatus: 'due_on_delivery', createdBy: 'adm_9' }));
		expect(page.codDue()).toEqual({ amountINR: 2000, by: null });
		data.set(
			detail(
				{ paymentStatus: 'due_on_delivery' },
				{ payments: [{ method: 'cashOnDelivery', state: 'received' }] },
			),
		);
		expect(page.codDue()).toBeNull();
		data.set(detail({ paymentStatus: 'due_on_delivery' }, { payments: [{ method: 'cash', state: 'received' }] }));
		expect(page.codDue()?.amountINR).toBe(2000);
	});

	it('formats money, rupees, days, times, addresses, phones and countries', () => {
		data.set(detail({ currency: 'GBP' }));
		const { page } = render({ lang: 'bn' });
		expect(page.money(null)).toBe('—');
		expect(page.money(12)).toBe('£12.00');
		expect(page.moneyIn(12, 'USD')).toBe('$12.00');
		expect(page.rupees(1200)).toBe('₹1,200');
		expect(page.day('2026-11-19')).toContain('Nov');
		expect(page.when('2026-11-19T10:00:00.000Z')).toContain('Nov');
		expect(page.address(null)).toBe('—');
		expect(page.address({ line1: '1 College St', line2: ' ', city: 'Kolkata', country: 'IN' } as never)).toContain(
			'1 College St, Kolkata, ',
		);
		expect(page.address({ line1: 'A', countryCode: 'GB', country: 'x' } as never)).toContain('A, ');
		expect(page.phone(null)).toBe('');
		expect(page.phone({ mobile: { countryCallingCode: '91', number: '98000' } } as never)).toBe('+91 98000');
		expect(page.country(null)).toBe('');
		expect(page.country('not a code')).toBe('not a code');
		expect(page.time(null)).toBe('');
		expect(page.time('2026-11-19T10:00:00.000Z')).toBe('15:30');
	});

	it('names payment and request states as chips', () => {
		const { page } = render();
		expect(
			['received', 'pending', 'refunded', 'partRefunded', 'failed'].map((state) =>
				page.paymentPill({ state } as never),
			),
		).toEqual(['success', 'pending', 'refund', 'refund', 'failed']);
		expect(
			['paid', 'active', 'expired', 'failed', 'cancelled'].map((status) => page.requestPill({ status } as never)),
		).toEqual(['success', 'pending', 'failed', 'failed', 'cancelled']);
	});

	it('words every kind of history line, and who did it', () => {
		data.set(detail({ channel: 'shop' }, { staff: { adm_1: 'Moulik Patra' } }));
		const { page } = render();
		const line = (entry: Record<string, unknown>) =>
			page.historyLine({ at: 'x', by: null, byName: null, messages: [], ...entry } as never);
		expect(line({ kind: 'status', to: 'shipped', detail: { courier: 'Blue Dart', proof: 'photo.jpg' } }).text).toBe(
			'Blue Dart · ord_hist_proof(photo.jpg)',
		);
		expect(line({ kind: 'created', detail: { items: '2 pieces', method: 'keepOpen' } }).text).toBe(
			'ord_hist_opened(2 pieces)',
		);
		expect(line({ kind: 'created', detail: { items: '2 pieces' } }).text).toBe('ord_hist_created_items(2 pieces)');
		expect(line({ kind: 'lineAdded', detail: { items: 'Silk' } }).text).toBe('ord_hist_added(Silk)');
		expect(line({ kind: 'lineAdded', detail: {} }).text).toBe('ord_history_lineAdded');
		expect(line({ kind: 'lineRemoved', detail: { title: 'Silk' } }).text).toBe('ord_hist_removed_one(1|Silk|₹0)');
		expect(line({ kind: 'lineRemoved', detail: { title: 'Silk', quantity: 2, amountINR: 500 } }).text).toBe(
			'ord_hist_removed_two(2|Silk|₹500)',
		);
		expect(line({ kind: 'lineRemoved', detail: { title: 'Silk', quantity: 3 } }).text).toContain(
			'ord_hist_removed_other',
		);
		expect(line({ kind: 'lineRemoved', detail: {} }).text).toBe('ord_history_lineRemoved');
		expect(line({ kind: 'comment', comment: 'Hi' })).toMatchObject({ text: 'ord_hist_comment(Hi)', comment: null });
		expect(line({ kind: 'comment' }).text).toBe('ord_hist_comment()');
		expect(
			line({ kind: 'payment', detail: { gateway: 'paypal', amountINR: 900, requestAt: '2026-11-19' } }).text,
		).toContain('ord_hist_paid_request(₹900|ord_req_gateway_paypal|');
		expect(line({ kind: 'payment', detail: { amountINR: 900, method: 'upi' } }).text).toBe(
			'ord_hist_payment_recorded(₹900|ord_method_upi)',
		);
		expect(line({ kind: 'payment', detail: { amountINR: 900 } }).text).toBe('ord_hist_payment_recorded(₹900|)');
		expect(line({ kind: 'payment', detail: { gateway: 'paypal' } }).text).toBe('ord_history_payment');
		expect(line({ kind: 'payment', detail: {} }).text).toBe('ord_history_payment');
		expect(line({ kind: 'invoiceAddress', comment: 'phoneCall' }).comment).toBe('ord_confirmed_phoneCall');
		expect(line({ kind: 'note', comment: 'just a note' }).comment).toBe('just a note');
		expect(page.historyComment({ kind: 'note' } as never)).toBe('');
		expect(line({ kind: 'note', by: 'adm_1' }).by).toBe('Moulik');
		expect(line({ kind: 'note', byName: 'Bina Das' }).by).toBe('Bina');
		expect(line({ kind: 'note' }).by).toBe('ord_by_shop');
		data.set(detail({ channel: 'admin' }));
		expect(line({ kind: 'note' }).by).toBe('ord_by_system');
	});

	it('words payment requests: amounts, who it went to, how long it lasts, attempts and checks', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-11-20T10:00:00.000Z'));
		data.set(detail({ lines: [line({ held: true, quantity: 2 })] }, { staff: { adm_1: 'Moulik Patra' } }));
		const { page } = render();
		expect(page.requestSentWords(request())).toContain('ord_req_sent_ccavenue');
		expect(
			page.requestedLine(
				request({ currency: 'USD', amount: 15, sentTo: { email: 'a@b.test', mobile: '+919800000000' } }),
			),
		).toContain('ord_req_to_both');
		expect(page.requestedLine(request({ sentTo: { email: 'a@b.test', mobile: null } }))).toContain(
			'a@b.test|Moulik',
		);
		expect(page.requestedLine(request({ createdBy: 'adm_9', sentTo: { email: null, mobile: '98' } }))).toContain(
			'98|ord_by_system',
		);
		expect(page.requestedLine(request())).toContain('—');
		expect(page.validLine(request({ status: 'expired' }))).toContain('ord_req_valid_expired');
		expect(page.validLine(request({ currency: 'USD' }))).toContain('ord_req_valid_fixed');
		expect(page.validLine(request())).toContain('ord_req_valid_held_other');
		data.set(detail({ lines: [line({ held: true })] }));
		expect(page.validLine(request())).toContain('ord_req_valid_held_one');
		data.set(detail());
		expect(page.validLine(request())).not.toContain('ord_req');
		expect(
			page.attemptsSummary(
				request({
					attempts: [
						{ state: 'failed', method: 'card', at: '2026-11-20T09:00:00.000Z' },
						{ state: 'failed', method: null, at: '2026-11-20T09:01:00.000Z' },
						{ state: 'captured', method: null, at: '2026-11-20T09:02:00.000Z' },
					],
				}),
			),
		).toContain('(ord_req_declined)');
		expect(page.paidAttempt(request())).toBeNull();
		expect(page.hasPendingAttempt(request({ attempts: [{ state: 'pending' }] }))).toBe(true);
		expect(page.checkedLine(request())).toBeNull();
		expect(page.checkedLine(request({ lastCheckedAt: '2026-11-20T09:59:30.000Z' }))).toContain(
			'ord_req_checked_just_now',
		);
		expect(page.checkedLine(request({ lastCheckedAt: '2026-11-20T09:00:00.000Z' }))).toContain(
			'ord_req_checked_at',
		);
		expect(page.smsReachable(request())).toBe(false);
		expect(page.smsReachable(request({ sentTo: { mobile: '+91 98000-00000' } }))).toBe(true);
	});

	it('words payments: method, who recorded it and when, and line prices and the buyer’s phone', () => {
		data.set(
			detail(
				{ buyer: { name: 'Asha Roy', mobile: { countryCallingCode: '91', number: '98000 00000' } } },
				{ staff: { adm_1: 'Moulik' } },
			),
		);
		const { page } = render();
		expect(
			page.paymentMethodWords({ method: 'gateway', gateway: { id: 'paypal', requestId: 'r1' } } as never),
		).toBe('ord_pay_method_link(ord_gateway_paypal)');
		expect(
			page.paymentMethodWords({ method: 'gateway', gateway: { id: 'ccavenue', requestId: null } } as never),
		).toBe('ord_pay_method_shop(ord_gateway_ccavenue)');
		expect(page.paymentMethodWords({ method: 'gateway', gateway: null } as never)).toBe('ord_method_gateway');
		expect(page.recordedBy({ gateway: { id: 'paypal' } } as never)).toBe('PayPal');
		expect(page.recordedBy({ gateway: { id: 'ccavenue' } } as never)).toBe('ord_recorded_by_gateway');
		expect(page.recordedBy({ gateway: null, recordedBy: 'adm_1' } as never)).toBe('Moulik');
		expect(page.recordedBy({ gateway: null, recordedBy: 'adm_9' } as never)).toBe('—');
		expect(page.recordedBy({ gateway: null, recordedBy: null } as never)).toBe('—');
		expect(page.receivedWhen({ gateway: { id: 'x' }, recordedAt: '2026-11-19T10:00:00.000Z' } as never)).toContain(
			'Nov',
		);
		expect(page.receivedWhen({ gateway: null, receivedOn: '2026-11-19' } as never)).toContain('Nov');
		expect(page.receivedWhen({ gateway: null, receivedOn: null } as never)).toBe('—');
		expect(page.linePrice(line({ pricing: { mrpUnitINR: 1200 } } as never))).toContain('ord_line_mrp_price');
		expect(page.linePrice(line({ pricing: { mrpUnitINR: 900 } } as never))).toBe('₹1,000');
		expect(page.linePrice(line())).toBe('₹1,000');
		expect(page.buyerPhone()).toBe('+91 98000 00000');
		data.set(detail({ buyer: { name: 'A', mobile: { countryCallingCode: '44', number: '7700 900' } } }));
		expect(page.buyerPhone()).toBe('+44 7700900');
		data.set(detail({ buyer: null }));
		expect(page.buyerPhone()).toBe('');
		expect(page.buyerFirstName()).toBe('');
	});

	it('sets, pieces and free items in the Pack list, with their options and ticks', () => {
		const set = line({ lineId: 'set', role: 'bundle', title: { en: 'Wedding set' } });
		const piece = line({
			lineId: 'p1',
			parentLineId: 'set',
			role: 'piece',
			attributes: { colour: 'Red' },
			lineTotalPaid: 600,
		});
		const extra = line({ lineId: 'x1', parentLineId: 'set', role: 'extra', lineTotalPaid: 100 });
		const pieceFree = line({
			lineId: 'f1',
			parentLineId: 'p1',
			role: 'free',
			addons: [{ code: 'fall', label: null, value: 'yes' }],
		});
		const product = line({ lineId: 'prod', title: { en: 'Silk' } });
		const lineFree = line({ lineId: 'f2', parentLineId: 'prod', role: 'free' });
		const noId = line({ lineId: null as never, title: undefined as never });
		data.set(
			detail({
				status: 'placed',
				lines: [set, piece, extra, pieceFree, product, lineFree, noId],
				packTicks: ['p1'],
			}),
		);
		const { page } = render();
		expect(page.setCounts(set)).toBe('ord_set_pieces_one(1) ord_set_extras(1)');
		expect(page.setCounts(product)).toBe('ord_set_pieces(0)');
		expect(page.setTotalPaid(set)).toBe(700);
		expect(page.attributeValues(piece)).toEqual(['Red']);
		expect(page.attributeValues(product)).toEqual([]);
		expect(page.freeCount(product)).toBe(1);
		expect(page.depthOf(pieceFree)).toBe(2);
		expect(page.depthOf(lineFree)).toBe(1);
		expect(page.pieceNumber(product)).toBe(0);
		const keys = page.packRows().map((row) => row.from.key);
		expect(keys).toEqual([
			'ord_pack_from_piece',
			'ord_pack_from_extra',
			'ord_pack_from_free_piece',
			'ord_pack_from_line',
			'ord_pack_from_free_line',
			'ord_pack_from_line',
		]);
		expect(page.packRows()[2]?.options).toBe('fall: yes');
		expect(page.packRows()[0]?.ticked).toBe(true);
		expect(page.packRows()[5]?.ticked).toBe(false);
		expect(page.packing()).toBe(true);
		expect(page.packTicked()).toBe(1);
		data.set(
			detail({ status: 'placed', lines: [line({ lineId: 'gone', parentLineId: 'missing', role: 'piece' })] }),
		);
		expect(page.packRows()[0]?.from).toEqual({ key: 'ord_pack_from_line', params: { n: 0 } });
		data.set(detail({ status: undefined as never }));
		expect(page.packing()).toBe(false);
	});
});

describe('the order page: more words', () => {
	it('a due total, requests, attempts, a lapsed request, open days, payments received and held pieces', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-11-20T00:00:00.000Z'));
		const held = line({ lineId: 'h', held: true, quantity: 2 });
		data.set(
			detail(
				{ openedAt: '2026-11-10T00:00:00.000Z', lines: [held, line({ lineId: 'n' })], history: undefined },
				{
					payments: [{ state: 'received' }, { state: 'pending' }],
					requests: [request({ id: 'old', status: 'active' }), request({ id: 'new', status: 'expired' })],
				},
			),
		);
		const { page } = render();
		expect(page.totalWords()).toBe('ord_total_due');
		expect(page.history()).toEqual([]);
		expect(page.activeRequest()?.id).toBe('old');
		expect(page.lapsedRequest()?.id).toBe('new');
		expect(page.openDays()).toBe(10);
		expect(page.receivedCount()).toBe(1);
		expect(page.heldPieces()).toBe(2);
		expect(page.packPieces()).toBe(3);
		expect(
			page.paidAttempt(request({ attempts: [{ state: 'failed' }, { state: 'captured', at: 'x' }] })),
		).toMatchObject({ state: 'captured' });
		data.set(detail({}, { requests: [request({ status: 'active' })] }));
		expect([page.packRows(), page.lapsedRequest(), page.heldPieces()]).toEqual([[], null, 0]);
	});

	it('a free item whose piece has no set, and a piece of a set with no name', () => {
		const piece = line({ lineId: 'p', parentLineId: 'gone', role: 'piece' });
		const free = line({ lineId: 'f', parentLineId: 'p', role: 'free' });
		const set = line({ lineId: 's', role: 'bundle', title: {} as never });
		const inSet = line({ lineId: 'q', parentLineId: 's', role: 'piece' });
		data.set(detail({ lines: [piece, free, set, inSet] }));
		const { page } = render();
		const rows = page.packRows();
		expect(rows.find((row) => row.line.lineId === 'f')?.from).toEqual({
			key: 'ord_pack_from_free_piece',
			params: { n: 0, set: '' },
		});
		expect(rows.find((row) => row.line.lineId === 'q')?.from.params).toEqual({ set: '', n: 1 });
	});
});

describe('the order page: actions', () => {
	it('status, comment, payment, request and invoice address popups: closed changes nothing, an answer refreshes', async () => {
		data.set(detail());
		const closed = render({ popups: [new Error('closed')] });
		await closed.page.updateStatus();
		await closed.page.recordPayment();
		await closed.page.requestPayment();
		await closed.page.addInvoiceAddress();
		expect(closed.notifier.showSuccess).not.toHaveBeenCalled();
		const { page, notifier, gateway } = render({ popups: [true] });
		await page.updateStatus();
		await page.recordPayment();
		await page.requestPayment(request());
		await page.addInvoiceAddress();
		h.reason = null;
		await page.addComment();
		h.reason = 'Called';
		await page.addComment();
		expect(gateway.comment).toHaveBeenCalledWith('ord_1', { comment: 'Called', revision: 4 });
		expect(notifier.showSuccess.mock.calls.map(([key]) => key)).toEqual([
			'ord_status_saved',
			'ord_payment_saved',
			'ord_request_sent_toast',
			'ord_invoice_address_saved',
			'ord_comment_saved',
		]);
	});

	it('ticks a piece, prints the pack list and a receipt, marks packed, and says why one failed', async () => {
		vi.useFakeTimers();
		data.set(detail());
		const { page, gateway, notifier } = render();
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		await page.tick(line({ lineId: null as never }), true);
		expect(gateway.packTick).not.toHaveBeenCalled();
		await page.tick(line(), true);
		expect(gateway.packTick).toHaveBeenCalledWith('ord_1', { lineId: 'l1', ticked: true, revision: 4 });
		await page.printPackList();
		await page.printReceipt('pay_1');
		expect(open).toHaveBeenCalledTimes(2);
		vi.advanceTimersByTime(60_000);
		expect(urls['revokeObjectURL']).toHaveBeenCalledTimes(2);
		await page.markPacked();
		expect(notifier.showSuccess).toHaveBeenCalledWith('ord_status_saved');
		gateway.changeStatus.mockReturnValueOnce(
			throwError(() => ({ error: { issues: [{ code: 'x', message: 'invoice_problem:no_hsn:ST-1' }] } })) as never,
		);
		await page.markPacked();
		expect(notifier.showError).toHaveBeenCalledWith('inv_problem_no_hsn(ST-1)');
		gateway.changeStatus.mockReturnValueOnce(
			throwError(() => ({ error: { issues: [{ code: 'x', message: 'Not now' }] } })) as never,
		);
		await page.markPacked();
		expect(notifier.showError).toHaveBeenLastCalledWith('Not now');
		expect(page.busy()).toBeNull();
	});

	it('removes a held line after asking, with or without a reason, and keeps it on a no', async () => {
		data.set(detail({ balance: { goodsINR: 3000, shippingINR: 100, couponINR: 0, paidINR: 500 } }));
		const { page, gateway } = render();
		await page.removeLine(line({ lineId: null as never }));
		h.comment = null;
		await page.removeLine(line({ quantity: 2 }));
		expect(gateway.removeOpenLine).not.toHaveBeenCalled();
		h.comment = { comment: '' };
		await page.removeLine(line());
		expect(gateway.removeOpenLine).toHaveBeenLastCalledWith('ord_1', { lineId: 'l1', reason: null, revision: 4 });
		h.comment = { comment: 'Wrong size' };
		data.set(detail());
		await page.removeLine(line({ quantity: 3 }));
		expect(gateway.removeOpenLine).toHaveBeenLastCalledWith('ord_1', {
			lineId: 'l1',
			reason: 'Wrong size',
			revision: 4,
		});
	});

	it('closes an open order and goes on to the request only when money is due and the order reloads', async () => {
		data.set(detail({ lines: [line({ held: true })] }));
		const closed = render({ popups: [new Error('closed')] });
		await closed.page.closeOrder();
		expect(h.refetch).not.toHaveBeenCalled();
		const later = render({ popups: [{ then: 'recordLater', dueINR: 900 }] });
		await later.page.closeOrder();
		expect(h.refetch).not.toHaveBeenCalled();
		const none = render({ popups: [{ then: 'requestOnline', dueINR: 0 }] });
		await none.page.closeOrder();
		expect(h.refetch).not.toHaveBeenCalled();
		h.refetch.mockResolvedValueOnce({ data: undefined });
		const gone = render({ popups: [{ then: 'requestOnline', dueINR: 900 }] });
		await gone.page.closeOrder();
		expect(gone.modals.open).toHaveBeenCalledTimes(1);
		h.refetch.mockResolvedValueOnce({ data: detail() });
		const { page, modals, instance } = render({ popups: [{ then: 'requestOnline', dueINR: 900 }, null] });
		await page.closeOrder();
		expect(modals.open).toHaveBeenCalledTimes(2);
		expect(instance.start).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'ord_1' }), null, 1);
	});

	it('marks a payment received after asking for the reference, and not on a no', async () => {
		data.set(detail());
		const { page, gateway, notifier } = render();
		h.reason = null;
		await page.markReceived({ id: 'pay_1', amountINR: 900 } as never);
		expect(gateway.markReceived).not.toHaveBeenCalled();
		h.reason = 'UTR123';
		await page.markReceived({ id: 'pay_1', amountINR: 900 } as never);
		expect(gateway.markReceived).toHaveBeenCalledWith(
			'ord_1',
			'pay_1',
			expect.objectContaining({ reference: 'UTR123' }),
		);
		expect(notifier.showSuccess).toHaveBeenCalledWith('ord_payment_saved');
	});

	it('checks a request: paid with or without a reference, recorded without detail, or not paid', async () => {
		data.set(detail());
		const { page, gateway, notifier } = render();
		gateway.checkRequest.mockReturnValueOnce(
			of({ recorded: true, payment: { amountINR: 900, reference: null } }) as never,
		);
		await page.checkRequest(request());
		expect(notifier.showSuccess).toHaveBeenLastCalledWith(
			'ord_request_paid_detail_toast(₹900|ord_req_gateway_ccavenue|—)',
		);
		gateway.checkRequest.mockReturnValueOnce(of({ recorded: true, payment: null }) as never);
		await page.checkRequest(request());
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('ord_request_paid_toast');
		await page.checkRequest(request());
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('ord_request_not_paid');
	});

	it('sends a message and says what happened to it', async () => {
		data.set(detail());
		const { page, notifier } = render({
			popups: [new Error('closed'), { status: 'delivered' }, { status: 'queued' }, { status: 'blocked' }],
		});
		await page.sendMessage(request(), 'sms');
		expect(notifier.showSuccess).not.toHaveBeenCalled();
		await page.sendMessage(request(), 'sms');
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('ord_send_result_sent');
		await page.sendMessage(request(), 'email');
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('ord_send_result_queued');
		await page.sendMessage(request(), 'email');
		expect(notifier.showError).toHaveBeenLastCalledWith('ord_send_result_not_sent(ord_send_why_blocked)');
	});

	it('cancels a request, copies a link, and says when copying failed', async () => {
		data.set(detail());
		const { page, gateway, notifier } = render();
		await page.cancelRequest(request());
		expect(gateway.cancelRequest).toHaveBeenCalledWith('ord_1', 'req_1');
		await page.copy(null);
		const writeText = vi.fn(async () => undefined);
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		await page.copy('https://pay.test/x');
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('ord_link_copied');
		writeText.mockRejectedValueOnce(new Error('denied'));
		await page.copy('https://pay.test/x');
		expect(notifier.showError).toHaveBeenCalledWith('ord_copy_failed');
	});

	it('raises an e-invoice at once, or opens the by-hand popup naming the right tax invoice', async () => {
		data.set(detail());
		const { page, invoices, instance, notifier } = render({ popups: [true, new Error('closed'), true] });
		await page.eDocument('eInvoice');
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('ord_edoc_saved');
		invoices.forOrder.mockReturnValueOnce(
			of([
				{ status: 'issued', shipmentId: 's1', number: 'TI/1' },
				{ status: 'draft', shipmentId: null, number: 'TI/0' },
			]) as never,
		);
		await page.eDocument('eWayBill');
		expect(instance.start).toHaveBeenLastCalledWith(expect.anything(), 'eWayBill', 'TI/1');
		invoices.forOrder.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await page.eDocument('eWayBill');
		expect(instance.start).toHaveBeenLastCalledWith(expect.anything(), 'eWayBill', null);
		invoices.forOrder.mockReturnValueOnce(of([{ status: 'issued', shipmentId: null, number: 'TI/2' }]) as never);
		await page.eDocument('eWayBill');
		expect(instance.start).toHaveBeenLastCalledWith(expect.anything(), 'eWayBill', 'TI/2');
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('ord_edoc_saved');
	});
});
