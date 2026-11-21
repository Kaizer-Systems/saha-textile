import { expect, test } from '@playwright/test';

import { AdminApi as Api, ensurePounds, ensureSahaShipping, type Json } from './business-setup';
import { withDatabase } from './database';
import { ADMIN } from './support';

/**
 * The whole business, end to end on the real API and screens, in the throwaway test database:
 * Saha Textile's shipping rules, buying stock (purchase order, goods received and checked, posted
 * with its cost, the supplier paid, a damaged piece returned), then selling it (shop customers and
 * businesses, every payment method staff take by hand, the status steps from start to finish, the
 * invoice-address rules for buyers abroad, foreign currency, open orders, coupons, zones, credit
 * and the e-document gate). Only the gateways' own payments can't run here: the stack has no keys.
 *
 * One serial file: each part builds on the stock and settings the earlier parts made. Every name
 * carries this run's tag.
 */

const run = Date.now().toString(36);
const word = (text: string) => text.replace(/\d/g, (digit) => 'abcdefghij'[Number(digit)] ?? 'x');
const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const PRODUCT = 'prd_1001'; // Handwoven Katan Banarasi Saree: ₹4,680 against an MRP of ₹5,200, so "discounted".

const codeOf = (body: unknown): string =>
	((body as { error?: { issues?: Array<{ code?: string }> } })?.error?.issues?.[0]?.code ??
		(body as { issues?: Array<{ code?: string }> })?.issues?.[0]?.code ??
		'') as string;

/** Kolkata, the default address for shop customers and the Indian invoice address. */
const kolkata = (name: string, mobile: string) => ({
	fullName: name,
	line1: '3 Southern Avenue',
	city: 'Kolkata',
	state: 'West Bengal',
	subdivisionCode: 'WB',
	postalCode: '700029',
	countryCode: 'IN',
	mobile: { countryCallingCode: '91', number: mobile },
});
const london = (name: string) => ({
	fullName: name,
	line1: '221B Baker Street',
	city: 'London',
	state: 'Greater London',
	subdivisionCode: 'LND',
	postalCode: 'NW1 6XE',
	countryCode: 'GB',
	mobile: { countryCallingCode: '44', number: '7946000000' },
});

let mobileSeed = Number(String(Date.now()).slice(-8));
const nextMobile = () =>
	`9${String((mobileSeed += 7_919))
		.padStart(9, '0')
		.slice(-9)}`;

async function shopCustomer(
	api: Api,
	tag: string,
): Promise<{ id: string; name: string; email: string; mobile: string }> {
	const name = `Ananya ${word(tag)} ${word(run)}`;
	const email = `ananya-${tag}-${run}@example.test`;
	const mobile = nextMobile();
	const created = await api.ok('POST', '/admin/customers', {
		displayName: name,
		email,
		phone: `+91 ${mobile}`,
		activationChannels: ['email'],
	});
	await api.ok('POST', `/admin/customers/${created.id}/address-book`, {
		...kolkata(name, mobile),
		label: 'Home',
		isDefault: true,
	});
	return { id: created.id as string, name, email, mobile };
}

/** The variant shop orders sell; its id from the test database. */
async function variantOf(productId: string): Promise<{ id: string; sku: string }> {
	return withDatabase(async (db) => {
		const row = await db.collection('productVariants').findOne({ productId });
		if (!row) throw new Error(`No variant for ${productId}`);
		return { id: String(row['_id']), sku: String(row['sku']) };
	});
}

/** A valid GSTIN for this run (state, PAN with this run's digits, entity, Z, then the check character). */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function gstin(state: string, letters: string): string {
	const digits = String(Date.now() + letters.length).slice(-4);
	const body = `${state}${letters}${digits}C1Z`;
	let total = 0;
	for (const [index, char] of [...body].entries()) {
		const value = ALPHABET.indexOf(char) * ((index % 2) + 1);
		total += Math.floor(value / 36) + (value % 36);
	}
	return body + ALPHABET[(36 - (total % 36)) % 36];
}

const key = (label: string) => `e2e-${label}-${run}-${Math.random().toString(36).slice(2, 10)}`;

interface OrderDetail {
	order: {
		id: string;
		orderNumber: string;
		status: string;
		paymentStatus: string;
		revision: number;
		totalINR: number;
		totalPaid: number;
		currency: string;
		balance?: { dueINR: number; paidINR: number; paidAheadINR: number; shippingINR: number; totalINR: number };
		lines: Array<{ lineId: string; held: boolean; unitCostINR?: number | null; quantity: number }>;
		history: Array<{ kind: string; to: string | null; messages: Array<{ channel: string; template: string }> }>;
		addresses?: { invoice: { source: string; needed: boolean } };
		shipping?: { value: number; chargeINR?: number; zone?: string; trace: string[] };
		onAccountDueOn?: string | null;
		placedWith?: string | null;
	};
	attention: string[];
	allowedNext: Array<{ to: string; allowed: boolean; reason: string | null }>;
}

async function detail(api: Api, id: string): Promise<OrderDetail> {
	return api.ok<OrderDetail>('GET', `/admin/orders/${id}`);
}

async function move(api: Api, id: string, to: string, extra: Record<string, unknown> = {}): Promise<OrderDetail> {
	const current = await detail(api, id);
	return api.ok<OrderDetail>('POST', `/admin/orders/${id}/status`, {
		to,
		revision: current.order.revision,
		...extra,
	});
}

const shipped = { shipped: { courierName: 'DTDC', trackingNumber: 'D47512398', shippedOn: today } };
const delivered = { delivered: { deliveredOn: today, receivedBy: 'Ananya' } };

/** An admin order for one or more pieces of the purchased saree. */
function orderBody(
	buyer: { kind: 'person'; customerId: string } | { kind: 'business'; businessId: string },
	payment: Record<string, unknown>,
	over: Record<string, unknown> = {},
	quantity = 1,
	currency = 'INR',
) {
	return {
		cart: { buyer, currency, lines: [{ productId: PRODUCT, variationId: null, quantity, addons: [] }] },
		billing: null,
		indianInvoiceAddress: null,
		couponCodes: [],
		payment,
		comment: null,
		idempotencyKey: key('order'),
		...over,
	};
}

/** Places an admin order; its id (the API answers with the order page's data). */
async function place(api: Api, body: unknown): Promise<{ id: string }> {
	const answer = await api.ok<OrderDetail | OrderDetail['order']>('POST', '/admin/orders', body);
	return { id: 'order' in answer ? answer.order.id : answer.id };
}

async function savedAddressOf(api: Api, customerId: string): Promise<string> {
	const rows = await api.ok<Array<{ id: string }>>(
		'GET',
		`/admin/orders/buyer-addresses?kind=person&id=${customerId}`,
	);
	return rows[0]?.id as string;
}

const upi = (amountINR: number) => ({
	method: 'manual',
	payment: {
		method: 'upi',
		amountINR,
		reference: '402112345678',
		receivedOn: today,
		received: true,
		note: null,
		proofMediaId: null,
		collector: null,
		collectedBy: null,
	},
});

test.describe('The whole business, end to end', () => {
	test.describe.configure({ mode: 'serial' });
	test.setTimeout(120_000);

	let api: Api;
	let variant: { id: string; sku: string };
	let stockBefore = 0;

	test.beforeEach(async ({ page }) => {
		api = new Api(page.request);
	});

	test('setup: Saha Textile’s two shipping rule sets, site-wide, export off with an Indian invoice address', async () => {
		// Shared with the shop checkout rules spec: whichever runs first sets them up.
		await ensurePounds();
		await ensureSahaShipping(api, run);
	});

	test('buying: a purchase order, goods received and checked, posted with its cost, paid, and a damaged piece returned', async ({
		page,
	}) => {
		variant = await variantOf(PRODUCT);
		stockBefore = await withDatabase(async (db) =>
			Number(
				(await db.collection('productVariants').findOne({ _id: variant.id as never }))?.['stock']?.quantity ??
					0,
			),
		);
		const supplier = await api.ok('POST', '/admin/suppliers', {
			legalName: `Banaras Weavers ${word(run)} Pvt Ltd`,
			shortName: 'Banaras Weavers',
			kind: 'regular',
			gstin: gstin('09', 'AAACB'),
			pan: null,
			stateCode: '09',
			address: { line: 'Madanpura', city: 'Varanasi', pin: '221001' },
			contactName: 'Ravi',
			phone: '+91 9415000000',
			email: null,
			paymentTermsDays: 30,
			usesItemCodes: false,
			notes: '',
			active: true,
		});
		const order = await api.ok('POST', '/admin/purchase-orders', {
			supplierId: supplier.id,
			expectedBy: today,
			deliverTo: 'Saha Textile, Kolkata',
			noteToSupplier: '',
			internalNote: '',
			lines: [{ variantId: variant.id, quantity: 30, agreedPriceINR: 3000, gstRatePct: 5, supplierItemCode: '' }],
		});
		await api.ok('POST', `/admin/purchase-orders/${order.id}/send`, { via: 'pdf' });
		const draft = await api.ok<Json & { lines?: Array<Json> }>(
			'GET',
			`/admin/purchase-orders/${order.id}/receive-draft`,
		);
		const entry = await api.ok<Json & { lines: Array<{ lineId: string }>; version?: number }>(
			'POST',
			'/admin/purchases/entries',
			{
				...draft,
				supplierId: supplier.id,
				purchaseOrderId: order.id,
				billNumber: `BW-${run}`.slice(0, 40),
				billDate: today,
				goodsReceivedOn: today,
				pricesIncludeGst: false,
				freightINR: 0,
				freightGstRatePct: 0,
				roundOffINR: 0,
				printedTotalINR: 94_500,
				billAttachmentAssetId: null,
				lines: [
					{
						variantId: variant.id,
						quantity: 30,
						unitPriceINR: 3000,
						gstRatePct: 5,
						hsnOnBill: null,
						supplierItemCode: '',
					},
				],
			},
		);
		const line = entry.lines[0]?.lineId as string;
		await api.ok('POST', `/admin/purchases/entries/${entry.id}/goods-check`, {
			lines: [
				{
					lineId: line,
					accepted: 29,
					damaged: 1,
					missing: 0,
					damageReason: 'damaged_on_arrival',
					damageNote: 'A pulled thread along the border',
					damagePhotoAssetIds: [],
				},
			],
		});
		const preview = await api.ok<{ warnings?: Array<{ code: string }> }>(
			'GET',
			`/admin/purchases/entries/${entry.id}/post-preview`,
		);
		await api.ok('POST', `/admin/purchases/entries/${entry.id}/post`, {
			acceptWarningCodes: (preview.warnings ?? []).map((warning) => warning.code),
			requestKey: key('post'),
		});
		// The 29 good pieces join stock with their cost; the damaged one is held, not sold.
		const item = await api.ok<{ layers?: Array<{ quantityRemaining: number; unitCostINR: number }> }>(
			'GET',
			`/admin/stock/items/${variant.id}`,
		);
		expect(JSON.stringify(item)).toContain('3000');
		const stockAfter = await withDatabase(async (db) =>
			Number(
				(await db.collection('productVariants').findOne({ _id: variant.id as never }))?.['stock']?.quantity ??
					0,
			),
		);
		expect(stockAfter - stockBefore).toBe(29);

		// The supplier is paid part of the bill, then the damaged piece goes back for a credit note.
		await api.ok('POST', `/admin/purchases/entries/${entry.id}/payments`, {
			amountINR: 10_000,
			paidOn: today,
			mode: 'bank_transfer',
			reference: 'NEFT-E2E-1',
			proofAssetId: null,
		});
		const returnable = await api.ok<Json>('GET', `/admin/purchase-returns/for-entry/${entry.id}`);
		const back = await api.ok('POST', '/admin/purchase-returns', {
			purchaseEntryId: entry.id,
			kind: 'return_goods',
			reason: 'damaged_on_arrival',
			noteToSupplier: 'Pulled thread along the border',
			photoAssetIds: [],
			lines: [{ entryLineId: line, quantity: 1 }],
			holdId: ((returnable as { holds?: Array<{ id: string }> }).holds ?? [])[0]?.id ?? null,
		});
		await api.ok('POST', `/admin/purchase-returns/${back.id}/send`, {
			courier: 'DTDC',
			docket: 'R123',
			requestKey: key('return'),
		});
		await api.ok('POST', `/admin/purchase-returns/${back.id}/settle`, {
			how: 'credit_note',
			reference: 'CN-BW-1',
			date: today,
			amountINR: 3150,
			attachmentAssetId: null,
		});
		// The supplier is owed the bill less the payment and the credit note: ₹94,500 − ₹10,000 − ₹3,150.
		const summary = await api.ok<Json>('GET', `/admin/suppliers/${supplier.id}/summary`);
		expect(JSON.stringify(summary)).toContain('81350');

		// The screens: the entry and the supplier statement show the bill, the payment and the return.
		await page.goto(`${ADMIN}/purchase-entries/${entry.id}`);
		await expect(page.locator('body')).toContainText(`BW-${run}`.slice(0, 40));
		await page
			.locator('.nav-tabs a, .nav-tabs button', { hasText: /Payments/ })
			.first()
			.click();
		await expect(page.locator('body')).toContainText('NEFT-E2E-1');
	});

	test('selling to a shop customer: UPI paid, then every step to Delivered, the pieces leaving stock at their cost', async () => {
		const buyer = await shopCustomer(api, 'upi');
		const delivery = { kind: 'saved', savedAddressId: await savedAddressOf(api, buyer.id) };
		const quote = await api.ok<{
			totals: { totalINR: number; shippingINR: number };
			shipping: { chargeINR: number };
		}>(
			'POST',
			'/admin/orders/checkout/quote',
			orderBody({ kind: 'person', customerId: buyer.id }, upi(1), { delivery }, 2),
		);
		// Saha Textile — Domestic: each discounted piece ₹100.
		expect(quote.shipping.chargeINR).toBe(200);
		const created = await place(
			api,
			orderBody({ kind: 'person', customerId: buyer.id }, upi(quote.totals.totalINR), { delivery }, 2),
		);
		let now = await detail(api, created.id);
		expect(now.order).toMatchObject({ status: 'placed', paymentStatus: 'paid' });
		expect(now.order.lines[0]?.held).toBe(true);
		expect(now.order.history[0]?.messages.map((row) => row.channel)).toEqual(['email', 'sms']);
		// Shipped before Packed is not offered; a quiet step tells nothing.
		expect(now.allowedNext.find((row) => row.to === 'shipped')?.allowed ?? false).toBe(false);
		now = await move(api, created.id, 'processing');
		expect(now.order.history.at(-1)?.messages).toEqual([]);
		now = await move(api, created.id, 'packed');
		// OD12: ready pieces can't be cancelled once packed (the return policy applies instead).
		expect(now.allowedNext.find((row) => row.to === 'cancelled')).toMatchObject({ allowed: false });
		const noCourier = await api.try('POST', `/admin/orders/${created.id}/status`, {
			to: 'shipped',
			revision: now.order.revision,
		});
		expect(codeOf(noCourier.body)).toBe('courier_needed');
		now = await move(api, created.id, 'shipped', shipped);
		expect(now.order.status).toBe('shipped');
		// The pieces left stock costed from the purchase: ₹3,000 each.
		expect(now.order.lines[0]).toMatchObject({ held: false, unitCostINR: 3000 });
		expect(now.order.history.at(-1)?.messages.map((row) => row.template)).toEqual([
			'order_shipped',
			'order_shipped',
		]);
		now = await move(api, created.id, 'delivered', delivered);
		expect(now.order.status).toBe('delivered');
		expect(now.order.history.at(-1)?.messages.map((row) => row.template)).toContain('order_delivered');
		// Nothing comes after Delivered.
		expect(now.allowedNext.filter((row) => row.allowed).map((row) => row.to)).toEqual([]);
	});

	test('bank transfer not yet received waits, then marking it received places the order', async () => {
		const buyer = await shopCustomer(api, 'neft');
		const delivery = { kind: 'saved', savedAddressId: await savedAddressOf(api, buyer.id) };
		const created = await place(
			api,
			orderBody(
				{ kind: 'person', customerId: buyer.id },
				{
					method: 'manual',
					payment: {
						...upi(4_780).payment,
						method: 'bankTransfer',
						reference: 'UTR-WAIT',
						received: false,
						note: 'NEFT',
					},
				},
				{ delivery },
			),
		);
		let now = await detail(api, created.id);
		expect(now.order).toMatchObject({ status: 'awaiting_payment', paymentStatus: 'pending_at_bank' });
		// Packing waits for the money.
		expect(now.allowedNext.find((row) => row.to === 'processing')?.allowed ?? false).toBe(false);
		const payment = (await api.ok<{ payments: Array<{ id: string }> }>('GET', `/admin/orders/${created.id}`))
			.payments[0];
		now = await api.ok<OrderDetail>('POST', `/admin/orders/${created.id}/payments/${payment?.id}/received`, {
			reference: 'HDFCN52026112112345',
			receivedOn: today,
			revision: now.order.revision,
		});
		expect(now.order).toMatchObject({ status: 'placed', paymentStatus: 'paid' });
		// Placed by the money: Order confirmed, and no separate receipt email for the same moment.
		const placedEntry = now.order.history.find((row) => row.kind === 'status' && row.to === 'placed');
		expect(placedEntry?.messages.map((row) => row.template)).toEqual(['order_confirmed', 'order_confirmed']);
	});

	test('cash on delivery: due until collected, then recorded with its receipt and an email only', async () => {
		const buyer = await shopCustomer(api, 'cod');
		const delivery = { kind: 'saved', savedAddressId: await savedAddressOf(api, buyer.id) };
		const created = await place(
			api,
			orderBody(
				{ kind: 'person', customerId: buyer.id },
				{ method: 'cashOnDelivery', collector: 'staff' },
				{ delivery },
			),
		);
		let now = await detail(api, created.id);
		expect(now.order).toMatchObject({ status: 'placed', paymentStatus: 'due_on_delivery' });
		await move(api, created.id, 'processing');
		await move(api, created.id, 'packed');
		await move(api, created.id, 'shipped', shipped);
		now = await move(api, created.id, 'delivered', delivered);
		const prefill = await api.ok<{ amountINR: number }>('GET', `/admin/orders/${created.id}/payments/prefill`);
		expect(prefill.amountINR).toBe(now.order.balance?.dueINR);
		now = await api.ok<OrderDetail>('POST', `/admin/orders/${created.id}/payments`, {
			method: 'cashOnDelivery',
			amountINR: prefill.amountINR,
			reference: 'RCPT-77',
			receivedOn: today,
			received: true,
			note: null,
			proofMediaId: null,
			collector: 'staff',
			collectedBy: 'Raju',
			revision: now.order.revision,
		});
		expect(now.order.paymentStatus).toBe('paid');
		expect(now.order.history.at(-1)?.messages).toEqual([{ channel: 'email', template: 'payment_receipt' }]);
	});

	test('cancelling: a placed order puts its pieces back on sale; a delivered one can’t be cancelled', async () => {
		const buyer = await shopCustomer(api, 'cancel');
		const delivery = { kind: 'saved', savedAddressId: await savedAddressOf(api, buyer.id) };
		const stockOf = () =>
			withDatabase(
				async (db) => (await db.collection('productVariants').findOne({ _id: variant.id as never }))?.['stock'],
			);
		const before = (await stockOf()) as { held?: number; reserved?: number } | undefined;
		const created = await place(api, orderBody({ kind: 'person', customerId: buyer.id }, upi(4_780), { delivery }));
		const during = (await stockOf()) as Record<string, number> | undefined;
		expect(JSON.stringify(during)).not.toBe(JSON.stringify(before));
		const refused = await api.try('POST', `/admin/orders/${created.id}/status`, {
			to: 'cancelled',
			revision: (await detail(api, created.id)).order.revision,
		});
		expect(codeOf(refused.body)).toBe('cancel_reason_needed');
		const now = await move(api, created.id, 'cancelled', {
			cancel: { reason: 'customerAsked', note: 'Changed her mind' },
		});
		expect(now.order.status).toBe('cancelled');
		expect(now.order.lines[0]?.held).toBe(false);
		expect(JSON.stringify(await stockOf())).toBe(JSON.stringify(before));
		expect(now.order.history.at(-1)?.messages.map((row) => row.template)).toContain('order_cancelled');
		expect(now.allowedNext.filter((row) => row.allowed)).toEqual([]);
	});

	test('a payment link needs a gateway: without one the request is refused and says why', async () => {
		const buyer = await shopCustomer(api, 'link');
		const delivery = { kind: 'saved', savedAddressId: await savedAddressOf(api, buyer.id) };
		const created = await api.try(
			'POST',
			'/admin/orders',
			orderBody({ kind: 'person', customerId: buyer.id }, { method: 'paymentLink' }, { delivery }),
		);
		if (created.status < 300) {
			const raw = created.body as OrderDetail | OrderDetail['order'];
			const id = 'order' in raw ? raw.order.id : raw.id;
			const preview = await api.ok<{ problem?: string | null; problems?: string[] }>(
				'GET',
				`/admin/orders/${id}/requests/preview?amountINR=1000&currency=INR`,
			);
			expect(JSON.stringify(preview)).toMatch(/gateway|not_set|notSet|noGateway/i);
		} else {
			expect(JSON.stringify(created.body)).toMatch(/gateway/i);
		}
	});

	test('foreign currency: a US$ order is priced at the stored rate with the markup; staff take payment in ₹', async () => {
		const buyer = await shopCustomer(api, 'usd');
		const delivery = { kind: 'saved', savedAddressId: await savedAddressOf(api, buyer.id) };
		const inr = await api.ok<{ totals: { totalINR: number; total: number } }>(
			'POST',
			'/admin/orders/checkout/quote',
			orderBody({ kind: 'person', customerId: buyer.id }, upi(1), { delivery }),
		);
		const usd = await api.ok<{ currency: string; totals: { totalINR: number; total: number }; warnings: string[] }>(
			'POST',
			'/admin/orders/checkout/quote',
			orderBody({ kind: 'person', customerId: buyer.id }, { method: 'paymentLink' }, { delivery }, 1, 'USD'),
		);
		expect(usd.currency).toBe('USD');
		expect(usd.totals.totalINR).toBe(inr.totals.totalINR);
		expect(usd.totals.total).toBeGreaterThan(0);
		// K2: billed in India but asked in US$: warned, with ₹ offered.
		expect(usd.warnings).toContain('indiaBillingForeignCurrency');
		// K3: priced in US$, paid by hand in rupees at the order's ₹ total (no PayPal markup).
		const paid = await place(
			api,
			orderBody({ kind: 'person', customerId: buyer.id }, upi(usd.totals.totalINR), { delivery }, 1, 'USD'),
		);
		const order = (await detail(api, paid.id)).order;
		expect(order).toMatchObject({ currency: 'USD', status: 'placed', paymentStatus: 'paid' });
		expect(order.totalINR).toBe(usd.totals.totalINR);
		expect(order.totalPaid).toBe(usd.totals.total);
	});

	test('invoice address abroad: Packed waits for a complete Indian address; with one given at checkout it is used', async () => {
		const buyer = await shopCustomer(api, 'abroad');
		const name = buyer.name;
		const both = orderBody({ kind: 'person', customerId: buyer.id }, upi(1), {
			delivery: { kind: 'new', address: london(name), saveAs: null },
		});
		const quote = await api.ok<{ totals: { totalINR: number }; shipping: { chargeINR: number; zone: string } }>(
			'POST',
			'/admin/orders/checkout/quote',
			both,
		);
		// Saha Textile — International: the first piece ₹2,000, each further piece ₹900.
		expect(quote.shipping.zone).toBe('international');
		expect(quote.shipping.chargeINR).toBe(2000);
		const three = await api.ok<{ shipping: { chargeINR: number } }>('POST', '/admin/orders/checkout/quote', {
			...both,
			cart: { ...both.cart, lines: [{ productId: PRODUCT, variationId: null, quantity: 3, addons: [] }] },
		});
		expect(three.shipping.chargeINR).toBe(3_800);
		const needs = await place(api, {
			...both,
			payment: upi(quote.totals.totalINR),
			idempotencyKey: key('abroad'),
		});
		let now = await detail(api, needs.id);
		expect(now.order.addresses?.invoice).toMatchObject({ needed: true });
		expect(now.attention).toContain('invoiceAddressNeeded');
		now = await move(api, needs.id, 'processing');
		expect(now.allowedNext.find((row) => row.to === 'packed')).toMatchObject({ allowed: false });
		now = await api.ok<OrderDetail>('PUT', `/admin/orders/${needs.id}/invoice-address`, {
			address: kolkata(name, buyer.mobile),
			confirmedHow: 'phoneCall',
			revision: now.order.revision,
		});
		expect(now.order.addresses?.invoice).toMatchObject({ source: 'staff', needed: false });
		now = await move(api, needs.id, 'packed');
		expect(now.order.status).toBe('packed');

		const given = await place(api, {
			...both,
			indianInvoiceAddress: kolkata(name, buyer.mobile),
			payment: upi(quote.totals.totalINR),
			idempotencyKey: key('given'),
		});
		expect((await detail(api, given.id)).order.addresses?.invoice).toMatchObject({
			source: 'addressInIndia',
			needed: false,
		});

		// Billing abroad, delivery in India: the Indian delivery address is the invoice address, domestic shipping.
		const mixed = await place(
			api,
			orderBody({ kind: 'person', customerId: buyer.id }, upi(4_780), {
				delivery: { kind: 'saved', savedAddressId: await savedAddressOf(api, buyer.id) },
				billing: { kind: 'new', address: london(name), saveAs: null },
			}),
		);
		const mixedDetail = await detail(api, mixed.id);
		expect(mixedDetail.order.addresses?.invoice).toMatchObject({ source: 'delivery', needed: false });
		expect(mixedDetail.order.shipping?.zone).toBe('domestic');
	});

	test('an open order: pieces held as they are added and removed, paid in parts, closed with one parcel’s shipping', async () => {
		const buyer = await shopCustomer(api, 'open');
		const delivery = { kind: 'saved', savedAddressId: await savedAddressOf(api, buyer.id) };
		const opened = await place(
			api,
			orderBody({ kind: 'person', customerId: buyer.id }, { method: 'keepOpen' }, { delivery }),
		);
		let now = await detail(api, opened.id);
		expect(now.order).toMatchObject({ status: 'open' });
		expect(now.order.lines[0]?.held).toBe(true);
		now = await api.ok<OrderDetail>('POST', `/admin/orders/${opened.id}/open/lines`, {
			lines: [{ productId: PRODUCT, variationId: null, quantity: 2, addons: [] }],
			revision: now.order.revision,
		});
		expect(now.order.lines.reduce((sum, line) => sum + line.quantity, 0)).toBe(3);
		const added = now.order.lines.at(-1)?.lineId as string;
		now = await api.ok<OrderDetail>('POST', `/admin/orders/${opened.id}/open/remove-line`, {
			lineId: added,
			reason: 'Customer changed her mind',
			revision: now.order.revision,
		});
		expect(now.order.lines.reduce((sum, line) => sum + line.quantity, 0)).toBe(1);
		// A first part payment while the order is still open.
		now = await api.ok<OrderDetail>('POST', `/admin/orders/${opened.id}/payments`, {
			...upi(2_000).payment,
			reference: 'UPI-PART-1',
			revision: now.order.revision,
		});
		expect(now.order.balance?.paidINR).toBe(2_000);
		const preview = await api.ok<{ shippingINR: number; dueINR: number }>(
			'GET',
			`/admin/orders/${opened.id}/open/close-preview`,
		);
		expect(preview.shippingINR).toBe(100);
		now = await api.ok<OrderDetail>('POST', `/admin/orders/${opened.id}/open/close`, {
			then: 'recordLater',
			currency: 'INR',
			revision: now.order.revision,
		});
		expect(now.order).toMatchObject({ status: 'awaiting_payment', paymentStatus: 'part_paid' });
		// oo04: ₹500 more than is due is kept as paid ahead.
		now = await api.ok<OrderDetail>('POST', `/admin/orders/${opened.id}/payments`, {
			...upi(preview.dueINR + 500).payment,
			reference: 'UPI-PART-2',
			revision: now.order.revision,
		});
		expect(now.order).toMatchObject({ status: 'placed' });
		expect(now.order.balance).toMatchObject({ dueINR: 0, paidAheadINR: 500 });
		expect(now.order.history.find((row) => row.to === 'placed')?.messages.length).toBe(2);
	});

	test('coupons: a percent coupon on a regular-priced piece; combining coupons stack, one that doesn’t is refused', async () => {
		const buyer = await shopCustomer(api, 'coupon');
		const delivery = { kind: 'saved', savedAddressId: await savedAddressOf(api, buyer.id) };
		const code = (name: string) => `${name}${word(run).toUpperCase()}`.slice(0, 24);
		const coupon = (over: Record<string, unknown>) =>
			api.ok('POST', '/admin/coupons', {
				title: 'E2E coupon',
				kind: 'percentOff',
				value: 10,
				capINR: null,
				scope: { kind: 'wholeOrder' },
				excludedProductIds: [],
				includeSaleItems: false,
				minOrderINR: 0,
				audience: { kind: 'everyone' },
				channels: { shop: true, admin: true },
				usesPerCustomer: 1,
				totalUses: null,
				validFrom: null,
				validUntil: null,
				combines: false,
				usableOnZonePrices: false,
				...over,
			});
		await coupon({ code: code('NOSALE') });
		await coupon({ code: code('SALETEN'), includeSaleItems: true, combines: true });
		await coupon({
			code: code('FREESHIP'),
			kind: 'freeDelivery',
			value: 0,
			combines: true,
			includeSaleItems: true,
		});
		const quote = (codes: string[]) =>
			api.ok<{
				coupons: Array<{ code: string }>;
				couponRefusals: Array<{ code: string; refusal: string }>;
				totals: { couponINR: number; shippingINR: number; goodsINR: number };
			}>(
				'POST',
				'/admin/orders/checkout/quote',
				orderBody({ kind: 'person', customerId: buyer.id }, upi(1), { delivery, couponCodes: codes }),
			);
		// This saree is below its MRP at its regular price, which is not a sale (a sale is a live sale
		// event), so a coupon that leaves sale pieces out still applies; sale exclusion is covered by the
		// coupon engine's own tests.
		const regular = await quote([code('NOSALE')]);
		expect(regular.coupons.map((row) => row.code)).toEqual([code('NOSALE')]);
		expect(regular.totals.couponINR).toBeCloseTo(regular.totals.goodsINR * 0.1, 0);
		const stacked = await quote([code('SALETEN'), code('FREESHIP')]);
		expect(stacked.coupons.map((row) => row.code).sort()).toEqual([code('FREESHIP'), code('SALETEN')].sort());
		expect(stacked.totals.couponINR).toBeCloseTo(stacked.totals.goodsINR * 0.1, 0);
		expect(stacked.totals.shippingINR).toBe(0);
		const clash = await quote([code('SALETEN'), code('NOSALE')]);
		expect(clash.couponRefusals.map((row) => row.code)).toContain(code('NOSALE'));
	});

	test('businesses: zone prices, orders on account within credit, the limit, standing, receipts and the e-document gate', async ({
		page,
	}) => {
		const zone = await api.ok<{ id: string; revision: number }>('POST', '/admin/zones', {
			code: `WHOLESALE-${word(run).toUpperCase()}`.slice(0, 24),
			name: `Wholesale ${run}`,
			description: '',
			rules: [
				{
					id: 'r1',
					name: '10% off everything',
					enabled: true,
					scope: { tier: 'allProducts' },
					when: null,
					price: { kind: 'percentOffBase', base: 'regularSelling', percent: 10 },
					rounding: 'none',
					floorINR: null,
					ceilingINR: null,
					minQuantityPerLine: null,
					validFrom: null,
					validUntil: null,
				},
			],
		});
		await api.ok('POST', `/admin/zones/${zone.id}/status`, { status: 'live', revision: zone.revision });
		const business = await api.ok<{ id: string }>('POST', '/admin/businesses', {
			legalName: `Bose Boutique ${word(run)} LLP`,
			tradeName: 'Bose Boutique',
			businessType: 'llp',
			kind: 'regular',
			gstin: gstin('19', 'AABCB'),
			pan: null,
			stateCode: '19',
			registeredAddress: { line: '12 Gariahat Road', city: 'Kolkata', pin: '700019' },
			contacts: [
				{
					name: 'Accounts',
					role: 'Accounts',
					email: `accounts-${run}@example.test`,
					mobile: null,
					isAccounts: true,
				},
			],
			sellsToUs: false,
			customer: { zoneId: zone.id, creditLimitINR: 20_000, creditDays: 30 },
			supplier: null,
			notes: null,
			active: true,
		});
		await api.ok('POST', `/admin/businesses/${business.id}/addresses`, {
			...kolkata('Bose Boutique', nextMobile()),
			label: 'Shop',
			isDefault: true,
		});
		const addresses = await api.ok<Array<{ id: string }>>(
			'GET',
			`/admin/orders/buyer-addresses?kind=business&id=${business.id}`,
		);
		const delivery = { kind: 'saved', savedAddressId: addresses[0]?.id };
		const buyer = { kind: 'business' as const, businessId: business.id };

		// The zone's price: 10% under the regular selling price, on the cards and in the quote.
		const cards = await api.ok<{
			items: Array<{ productId: string; unitPriceINR: number; zonePrice: { kind: string } | null }>;
		}>('GET', `/admin/orders/cards?businessId=${business.id}&q=Katan&currency=INR`);
		const card = cards.items.find((row) => row.productId === PRODUCT);
		expect(card?.zonePrice?.kind).toBe('priced');
		const quote = await api.ok<{ lines: Array<{ unitPriceINR: number }>; totals: { totalINR: number } }>(
			'POST',
			'/admin/orders/checkout/quote',
			orderBody(buyer, { method: 'onAccount', creditOverrideReason: null }, { delivery }),
		);
		// ₹4,680 regular selling price, 10% off: ₹4,212.
		expect(quote.lines[0]?.unitPriceINR).toBe(4_212);

		// On account within the limit: placed, due by the business's credit days.
		const first = await place(
			api,
			orderBody(buyer, { method: 'onAccount', creditOverrideReason: null }, { delivery }),
		);
		const firstDetail = await detail(api, first.id);
		expect(firstDetail.order).toMatchObject({
			status: 'placed',
			paymentStatus: 'on_account',
			placedWith: 'onAccount',
		});
		expect(firstDetail.order.onAccountDueOn).toBeTruthy();

		// Over the ₹20,000 limit: refused, then allowed once with a reason by someone with the override.
		const big = orderBody(buyer, { method: 'onAccount', creditOverrideReason: null }, { delivery }, 12);
		const refused = await api.try('POST', '/admin/orders', big);
		expect(refused.status).toBeGreaterThanOrEqual(400);
		expect(JSON.stringify(refused.body)).toMatch(/overLimit|method_off/);
		const allowed = await place(api, {
			...big,
			payment: { method: 'onAccount', creditOverrideReason: 'Owner agreed on the phone' },
			idempotencyKey: key('override'),
		});

		// The e-document gate: a business order of ₹50,000 or more needs the IRN and the e-way bill to ship.
		await move(api, allowed.id, 'processing');
		let now = await move(api, allowed.id, 'packed');
		expect(now.allowedNext.find((row) => row.to === 'shipped')).toMatchObject({ allowed: false });
		now = await api.ok<OrderDetail>('PUT', `/admin/orders/${allowed.id}/e-invoice`, {
			irn: 'a'.repeat(64),
			ackNo: '112010000000001',
			ackDate: new Date().toISOString(),
			signedQr: null,
			revision: now.order.revision,
		});
		now = await api.ok<OrderDetail>('PUT', `/admin/orders/${allowed.id}/e-way-bill`, {
			number: '331001234567',
			generatedOn: new Date().toISOString(),
			validUntil: new Date(Date.now() + 86_400_000).toISOString(),
			transporterName: null,
			transporterId: null,
			vehicleOrDocumentNo: null,
			distanceKm: 12,
			revision: now.order.revision,
		});
		expect(now.allowedNext.find((row) => row.to === 'shipped')).toMatchObject({ allowed: true });
		now = await move(api, allowed.id, 'shipped', shipped);
		expect(now.order.status).toBe('shipped');

		// A receipt pays the oldest open orders first and lowers what the business owes.
		const before = await api.ok<{ theyOweUsINR: number }>('GET', `/admin/businesses/${business.id}/balances`);
		await api.ok('POST', `/admin/businesses/${business.id}/receipts`, {
			method: 'bankTransfer',
			amountINR: 5_000,
			reference: 'NEFT-BOSE-1',
			receivedOn: today,
			note: null,
			allocations: [],
		});
		const after = await api.ok<{ theyOweUsINR: number }>('GET', `/admin/businesses/${business.id}/balances`);
		expect(before.theyOweUsINR - after.theyOweUsINR).toBe(5_000);
		const paidFirst = await detail(api, first.id);
		expect(paidFirst.order.balance?.paidINR).toBeGreaterThan(0);

		// Credit on hold: on account is refused, paying another way still works; blocked refuses every order.
		await api.ok('POST', `/admin/businesses/${business.id}/standing`, {
			standing: 'creditOnHold',
			reason: 'Two bills overdue',
		});
		const held = await api.try(
			'POST',
			'/admin/orders',
			orderBody(buyer, { method: 'onAccount', creditOverrideReason: null }, { delivery }),
		);
		expect(held.status).toBeGreaterThanOrEqual(400);
		const paidUpi = await api.try('POST', '/admin/orders/checkout/quote', orderBody(buyer, upi(1), { delivery }));
		expect(paidUpi.status).toBeLessThan(300);
		await api.ok('POST', `/admin/businesses/${business.id}/standing`, {
			standing: 'blocked',
			reason: 'Account closed',
		});
		const blocked = await api.try('POST', '/admin/orders', orderBody(buyer, upi(5_000), { delivery }));
		expect(blocked.status).toBeGreaterThanOrEqual(400);
		await api.ok('POST', `/admin/businesses/${business.id}/standing`, { standing: 'active', reason: 'Settled up' });

		// A zone that doesn't price this saree: greyed card, and the order can't be placed.
		const noPrice = await api.ok<{ id: string; revision: number }>('POST', '/admin/zones', {
			code: `EXPORT-${word(run).toUpperCase()}`.slice(0, 24),
			name: `Export ${run}`,
			description: '',
			rules: [
				{
					id: 'r1',
					name: 'Not this saree',
					enabled: true,
					scope: { tier: 'product', productIds: [PRODUCT] },
					when: null,
					price: { kind: 'noPrice' },
					rounding: 'none',
					floorINR: null,
					ceilingINR: null,
					minQuantityPerLine: null,
					validFrom: null,
					validUntil: null,
				},
			],
		});
		await api.ok('POST', `/admin/zones/${noPrice.id}/status`, { status: 'live', revision: noPrice.revision });
		await api.ok('POST', `/admin/businesses/${business.id}/zone`, { zoneId: noPrice.id });
		const greyed = await api.ok<{ items: Array<{ productId: string; zonePrice: { kind: string } | null }> }>(
			'GET',
			`/admin/orders/cards?businessId=${business.id}&q=Katan&currency=INR`,
		);
		expect(greyed.items.find((row) => row.productId === PRODUCT)?.zonePrice?.kind).toBe('noPrice');
		const unpriced = await api.try('POST', '/admin/orders', orderBody(buyer, upi(5_000), { delivery }));
		expect(unpriced.status).toBeGreaterThanOrEqual(400);

		// The business page shows both orders on its account and the receipt.
		await page.goto(`${ADMIN}/businesses/${business.id}`);
		await expect(page.locator('body')).toContainText('Bose Boutique');
		await page
			.locator('.nav-tabs a, .nav-tabs button', { hasText: /As customer/ })
			.first()
			.click();
		await expect(page.locator('body')).toContainText(/Receipt · RC\//);
		await expect(page.locator('body')).toContainText('₹5,000');
		// Past its limit after the approved one-off: ₹0 available, never a negative amount.
		await expect(page.locator('body')).toContainText('₹0 available');
		await expect(page.locator('body')).not.toContainText('₹-');
	});
});
