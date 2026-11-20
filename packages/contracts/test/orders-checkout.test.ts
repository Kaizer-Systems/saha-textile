import { describe, expect, it } from 'vitest';

import {
	AdminOrderCreate,
	BusinessWrite,
	CouponBulkAction,
	CouponCode,
	CouponWrite,
	DEFAULT_DOCUMENT_NUMBERING,
	DocumentNumberingSettings,
	EInvoiceWrite,
	EWayBillWrite,
	GST_DOCUMENT_TYPES,
	GST_NUMBER_MAX_LENGTH,
	ManualPaymentWrite,
	NumberedDocumentType,
	Order,
	OrderListQuery,
	OrderSettings,
	PURCHASED_STORED_ORDER_STATUSES,
	PostalAddressInput,
	PriceZoneWrite,
	SavedAddressWrite,
	SetOffWrite,
	StatusChangeWrite,
	ZonePricingSettings,
	formatPhoneNumber,
} from '../src/index';

const legacyRow = {
	id: 'order_1',
	orderNumber: 'SAHA-TEXTILE-20261101-ABC123',
	currency: 'INR',
	lines: [
		{
			productId: 'prd_1',
			title: { en: 'Saree' },
			sku: 'SKU-1',
			quantity: 1,
			unitPriceINR: 1000,
			unitPricePaid: 1000,
			lineTotalINR: 1000,
			lineTotalPaid: 1000,
		},
	],
	subtotalINR: 1000,
	subtotalPaid: 1000,
	totalINR: 1000,
	totalPaid: 1000,
};

describe('orders (v2 record)', () => {
	it('reads rows written with the first status list without rewriting them', () => {
		expect(Order.parse({ ...legacyRow, status: 'pending' }).status).toBe('awaiting_payment');
		expect(Order.parse({ ...legacyRow, status: 'paid' }).status).toBe('placed');
		expect(Order.parse({ ...legacyRow, status: 'refunded' }).status).toBe('cancelled');
		const order = Order.parse({
			...legacyRow,
			status: 'paid',
			statusTimeline: [{ status: 'paid', at: '2026-11-01T00:00:00Z' }],
		});
		expect(order.statusTimeline[0]?.status).toBe('placed');
		expect(order.channel).toBe('shop');
		expect(order.paymentStatus).toBe('unpaid');
		expect(order.lines[0]?.held).toBe(false);
		expect(order.coupons).toEqual([]);
		expect(order.revision).toBe(0);
	});

	it('filters purchased orders in the database by both status lists', () => {
		expect(PURCHASED_STORED_ORDER_STATUSES).toContain('placed');
		expect(PURCHASED_STORED_ORDER_STATUSES).toContain('paid');
		expect(PURCHASED_STORED_ORDER_STATUSES).not.toContain('awaiting_payment');
	});

	it('lets an open order have no lines left', () => {
		expect(Order.parse({ ...legacyRow, lines: [], status: 'open' }).lines).toEqual([]);
	});

	it('takes a date range on the orders list', () => {
		const query = OrderListQuery.parse({ from: '2026-11-01', to: '2026-11-20', page: '2' });
		expect(query).toMatchObject({ from: '2026-11-01', to: '2026-11-20', page: 2, filter: 'all' });
		expect(() => OrderListQuery.parse({ from: '01/11/2026' })).toThrow();
	});
});

describe('addresses (DEC-ADDRESS)', () => {
	const indian = {
		fullName: 'Ananya Sen',
		line1: '12 Lake Road',
		city: 'Kolkata',
		state: 'West Bengal',
		subdivisionCode: 'WB',
		postalCode: '৭০০০২৯',
		countryCode: 'in',
		mobile: { countryCallingCode: '91', number: '098300 12345' },
	};

	it('cleans what was typed: Bengali digits, spaces, the trunk 0, a lower-case country', () => {
		const address = PostalAddressInput.parse(indian);
		expect(address.postalCode).toBe('700029');
		expect(address.countryCode).toBe('IN');
		expect(address.mobile.number).toBe('9830012345');
		expect(formatPhoneNumber(address.mobile)).toBe('+91 9830012345');
	});

	it('needs a name for a saved address', () => {
		expect(() => SavedAddressWrite.parse(indian)).toThrow();
		expect(SavedAddressWrite.parse({ ...indian, label: ' Home ' }).label).toBe('Home');
	});

	it('refuses letters other than English in the delivery details', () => {
		expect(() => PostalAddressInput.parse({ ...indian, city: 'কলকাতা' })).toThrow();
	});
});

describe('document numbers (DEC-NUMBERING)', () => {
	it('defaults to the accepted table, every type present', () => {
		const settings = DocumentNumberingSettings.parse(DEFAULT_DOCUMENT_NUMBERING);
		for (const type of NumberedDocumentType.options) expect(settings.series[type]).toBeDefined();
		expect(settings.series.taxInvoice).toMatchObject({ prefix: 'TI', digits: 6, reset: 'fy' });
		expect(settings.series.purchaseEntry.digits).toBe(5);
		expect(settings.order).toMatchObject({ kind: 'randomGroups', prefix: 'ST', groups: [5, 5] });
		expect(settings.orderFormatChosenByOwner).toBe(false);
	});

	it('keeps every GST default within 16 characters', () => {
		for (const type of GST_DOCUMENT_TYPES) {
			const format = DEFAULT_DOCUMENT_NUMBERING.series[type];
			const longest = `${format.prefix}${format.separator}99-00${format.separator}${'9'.repeat(format.digits)}`;
			expect(longest.length).toBeLessThanOrEqual(GST_NUMBER_MAX_LENGTH);
		}
	});
});

describe('zones (DEC-B2B-ZONES)', () => {
	it('leaves every open question unchosen', () => {
		expect(ZonePricingSettings.parse({})).toMatchObject({
			saleMeetsZone: null,
			gstInZonePrice: null,
			categoryClash: null,
			couponsOnZoneLines: null,
		});
	});

	it('takes a flat price or a percentage less than retail, nothing else yet', () => {
		const base = { code: 'WHOLESALE-A', name: 'Wholesale A', priceList: { categories: [], products: [] } };
		expect(
			PriceZoneWrite.parse({ ...base, priceList: { allProducts: { kind: 'percentOffRetail', percent: 20 } } }),
		).toBeTruthy();
		expect(() =>
			PriceZoneWrite.parse({ ...base, priceList: { allProducts: { kind: 'percentOffRetail', percent: 0 } } }),
		).toThrow();
		expect(() =>
			PriceZoneWrite.parse({ ...base, priceList: { allProducts: { kind: 'markup', percent: 5 } } }),
		).toThrow();
		expect(() => PriceZoneWrite.parse({ ...base, code: 'retail' })).toThrow();
	});
});

describe('businesses', () => {
	const base = {
		legalName: 'Boutique Ltd',
		businessType: 'privateLimited',
		kind: 'regular',
		gstin: '27AAPFU0939F1ZV',
		stateCode: '27',
		registeredAddress: { line: '1 Park Street', city: 'Kolkata', pin: '700016' },
		sellsToUs: false,
		customer: { zoneId: 'zone_retail', creditLimitINR: 200000, creditDays: 30 },
	};

	it('needs at least one role', () => {
		expect(BusinessWrite.safeParse(base).success).toBe(true);
		expect(BusinessWrite.safeParse({ ...base, customer: null }).success).toBe(false);
	});

	it('keeps the GSTIN and State together, and one accounts contact', () => {
		expect(BusinessWrite.safeParse({ ...base, stateCode: '19' }).success).toBe(false);
		const two = [
			{ name: 'A', isAccounts: true },
			{ name: 'B', isAccounts: true },
		];
		expect(BusinessWrite.safeParse({ ...base, contacts: two }).success).toBe(false);
	});

	it('records a one-off set-off only with its own signed copy', () => {
		expect(SetOffWrite.safeParse({ amountINR: 5000, basis: { kind: 'oneOff' }, note: 'agreed' }).success).toBe(
			false,
		);
		expect(
			SetOffWrite.safeParse({
				amountINR: 5000,
				basis: { kind: 'oneOff', reference: 'SO-1', signedOn: '2026-11-20', mediaId: 'med_1' },
				note: 'agreed in writing',
			}).success,
		).toBe(true);
	});
});

describe('coupons (DEC-PROMO-STACK)', () => {
	const coupon = { code: 'diwali10', title: 'Diwali', kind: 'percentOff', value: 10 };

	it('stores codes upper case and defaults to OD4', () => {
		const parsed = CouponWrite.parse(coupon);
		expect(parsed.code).toBe('DIWALI10');
		expect(parsed).toMatchObject({ includeSaleItems: false, usesPerCustomer: 1, combines: false, enabled: true });
		expect(() => CouponCode.parse('a b')).toThrow();
	});

	it('checks values per kind', () => {
		expect(CouponWrite.safeParse({ ...coupon, value: 120 }).success).toBe(false);
		expect(CouponWrite.safeParse({ ...coupon, kind: 'amountOff', value: 99.5 }).success).toBe(false);
		expect(CouponWrite.safeParse({ ...coupon, kind: 'amountOff', value: 500, capINR: 100 }).success).toBe(false);
		expect(CouponWrite.safeParse({ ...coupon, channels: { shop: false, admin: false } }).success).toBe(false);
	});

	it('takes bulk Delete, Turn on and Turn off', () => {
		expect(CouponBulkAction.parse({ action: 'turnOff', ids: ['c1', 'c2'] }).ids).toHaveLength(2);
		expect(() => CouponBulkAction.parse({ action: 'archive', ids: ['c1'] })).toThrow();
	});
});

describe('admin order actions', () => {
	it('records manual payments in rupees with a reference', () => {
		expect(
			ManualPaymentWrite.safeParse({
				method: 'upi',
				amountINR: 27700,
				reference: '',
				receivedOn: '2026-11-20',
				revision: 1,
			}).success,
		).toBe(false);
		expect(
			ManualPaymentWrite.parse({
				method: 'upi',
				amountINR: 27700,
				reference: '402112345678',
				receivedOn: '2026-11-20',
				revision: 1,
			}).received,
		).toBe(true);
	});

	it('takes the courier details for Shipped', () => {
		const change = StatusChangeWrite.parse({
			to: 'shipped',
			shipped: { courierName: 'DTDC', trackingNumber: 'D47512398', shippedOn: '2026-11-20' },
			revision: 3,
		});
		expect(change.shipped?.mode).toBe('manual');
		expect(change.shipped?.trackingUrl).toBeNull();
	});

	it('checks the e-invoice IRN and e-way bill number shapes', () => {
		const ackDate = '2026-11-20T10:00:00+05:30';
		expect(
			EInvoiceWrite.safeParse({ irn: 'a'.repeat(64), ackNo: '112010000000001', ackDate, revision: 1 }).success,
		).toBe(true);
		expect(EInvoiceWrite.safeParse({ irn: 'a'.repeat(63), ackNo: '1', ackDate, revision: 1 }).success).toBe(false);
		const ewb = { number: '391000000001', generatedOn: ackDate, validUntil: ackDate, revision: 1 };
		expect(EWayBillWrite.safeParse(ewb).success).toBe(true);
		expect(EWayBillWrite.safeParse({ ...ewb, number: '39100000000' }).success).toBe(false);
	});

	it('needs an idempotency key and a buyer to create an order', () => {
		const create = {
			cart: { buyer: { kind: 'person', customerId: 'cus_1' }, currency: 'INR', lines: [] },
			delivery: { kind: 'saved', savedAddressId: 'adr_1' },
			billing: null,
			payment: { method: 'keepOpen' },
			idempotencyKey: 'k'.repeat(20),
		};
		expect(AdminOrderCreate.safeParse(create).success).toBe(true);
		expect(AdminOrderCreate.safeParse({ ...create, idempotencyKey: 'short' }).success).toBe(false);
		expect(AdminOrderCreate.safeParse({ ...create, cart: { ...create.cart, buyer: null } }).success).toBe(false);
	});

	it('keeps the e-documents gate off by default, as the approved brief draws Shipped', () => {
		expect(OrderSettings.parse({}).eDocumentsBeforeShipped).toBe('off');
		expect(OrderSettings.parse({}).holdAdminOrderPieces).toBe('fromSave');
		expect(OrderSettings.parse({}).paymentLinkDays).toBe(7);
	});
});
