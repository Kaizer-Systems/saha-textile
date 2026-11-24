/**
 * The accounts run's scenarios, in order; each builds on the ones before through `ctx`. Figures are worked out by
 * hand in the comments and checked against what the books say. Dates are spread over FY 2026-27 so past months'
 * GST and reports are checked too.
 */

import { Admin } from './client.mjs';
import { secondAdmin, setProductHsn, variantOf } from './stack.mjs';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** A valid GSTIN: state, the PAN, entity 1, Z, then the check character. */
export function gstin(state, pan) {
	const body = `${state}${pan}1Z`;
	let total = 0;
	for (const [index, char] of [...body].entries()) {
		const value = ALPHABET.indexOf(char) * ((index % 2) + 1);
		total += Math.floor(value / 36) + (value % 36);
	}
	return body + ALPHABET[(36 - (total % 36)) % 36];
}

export const PAN = 'ABCPS1234K';
export const GSTIN = gstin('19', PAN);
const run = Date.now().toString(36);
export const key = (label) => `acc-e2e-${label}-${run}-${Math.random().toString(36).slice(2, 8)}`;
const rupees = (paise) => Math.round(paise) / 100;

/** A shop customer with one saved address; their id and the address's id. */
async function customerWith(admin, name, address) {
	const customer = await admin.ok('POST', '/admin/customers', {
		displayName: name,
		email: `${name.toLowerCase().replace(/\W+/g, '-')}-${key('c')}@example.test`,
		phone: `+91 ${address.mobile.number}`,
		activationChannels: ['email'],
	});
	await admin.ok('POST', `/admin/customers/${customer.id}/address-book`, {
		...address,
		label: 'Home',
		isDefault: true,
	});
	const rows = await admin.ok('GET', '/admin/orders/buyer-addresses', undefined, { kind: 'person', id: customer.id });
	return { id: customer.id, addressId: rows[0].id };
}

/** An admin order taken to Delivered on the days given; the order id and its tax invoice. */
async function sell(admin, { customer, quantity, payment, shippedOn, deliveredOn }) {
	const created = await admin.ok('POST', '/admin/orders', {
		cart: {
			buyer: { kind: 'person', customerId: customer.id },
			currency: 'INR',
			lines: [{ productId: 'prd_1001', variationId: null, quantity, addons: [] }],
		},
		delivery: { kind: 'saved', savedAddressId: customer.addressId },
		billing: null,
		indianInvoiceAddress: null,
		couponCodes: [],
		comment: null,
		payment: {
			method: 'manual',
			payment: { note: null, proofMediaId: null, collector: null, collectedBy: null, received: true, ...payment },
		},
		idempotencyKey: key('o'),
	});
	const orderId = created.order?.id ?? created.id;
	const move = async (to, extra = {}) => {
		let now = await admin.ok('GET', `/admin/orders/${orderId}`);
		if (to === 'packed')
			for (const line of now.order.lines) {
				if (!line.lineId || line.role === 'bundle' || (now.order.packTicks ?? []).includes(line.lineId))
					continue;
				now = await admin.ok('PUT', `/admin/orders/${orderId}/pack-ticks`, {
					lineId: line.lineId,
					ticked: true,
					revision: now.order.revision,
				});
			}
		return admin.ok('POST', `/admin/orders/${orderId}/status`, { to, revision: now.order.revision, ...extra });
	};
	await move('processing');
	await move('packed');
	await move('shipped', { shipped: { courierName: 'DTDC', trackingNumber: key('t').slice(0, 20), shippedOn } });
	await move('delivered', { delivered: { deliveredOn, receivedBy: 'Buyer' } });
	const [invoice] = await admin.ok('GET', `/admin/orders/${orderId}/invoices`);
	return { orderId, invoice };
}

const sumBalances = (balances) => Object.values(balances).reduce((a, b) => a + b, 0);

/** Shared between scenarios. */
export const ctx = {};

const balanceOf = (chart, balances, systemKey) => {
	const ledger = chart.ledgers.find((l) => l.systemKey === systemKey || (l.roles ?? []).includes(systemKey));
	return ledger ? (balances[ledger.id] ?? 0) : 0;
};

export const scenarios = [
	{
		name: 'Company: a proprietorship in West Bengal, books from 1 April 2026',
		async run({ admin }) {
			const current = await admin.ok('GET', '/admin/company');
			await admin.ok('PUT', '/admin/company', {
				profile: {
					kind: 'proprietorship',
					legalName: 'KR Marketing Test',
					tradeName: 'Saha Textile Test',
					pan: PAN,
					tan: null,
					cin: null,
					llpin: null,
					udyam: null,
					financialYearStartMonth: 4,
					booksStartOn: '2026-04-01',
					homeCurrency: 'INR',
					proprietor: { name: 'Test Proprietor', pan: PAN, openingCapitalINR: 0 },
					otherBusinesses: [],
					partners: [],
					partnersCapital: 'fixed_with_current',
					directors: [],
					shareholders: [],
					authorisedCapitalINR: 0,
					paidUpCapitalINR: 0,
					faceValueINR: 10,
					nomineeName: null,
					revision: current?.profile?.revision ?? 0,
				},
				expectedUpdatedAt: current?.profile?.updatedAt ?? null,
			});
			const registration = await admin.ok('POST', '/admin/company/registrations', {
				gstin: GSTIN,
				legalName: 'KR Marketing Test',
				tradeName: 'Saha Textile Test',
				terms: { from: '2026-04-01', kind: 'regular', scheme: 'monthly', lastYearTurnoverINR: 4_00_00_000 },
				active: true,
			});
			ctx.registrationId = registration.id;
			return `GSTIN ${GSTIN}`;
		},
	},
	{
		name: 'Two locations: the Gariahat store (counter, cash box) and the warehouse',
		async run({ admin }) {
			const base = {
				courierPickup: false,
				showOnStoresPage: false,
				storeLocationId: null,
				stateCode: '19',
				phone: '',
				openingHours: '',
				shopsEstablishmentNo: '',
				gstRegistrationId: ctx.registrationId,
				invoiceIdentity: 'company',
				numberSeries: 'gstin',
				pettyCashFloatINR: 0,
				active: true,
				expectedUpdatedAt: null,
			};
			const store = await admin.ok('POST', '/admin/locations', {
				...base,
				name: 'Gariahat store',
				shortCode: 'GRH',
				warehouse: true,
				store: true,
				office: false,
				shipsOnline: true,
				address: '3 Gariahat Road',
				pin: '700019',
				city: 'Kolkata',
				counterCashBox: true,
				pettyCashFloatINR: 2000,
			});
			const warehouse = await admin.ok('POST', '/admin/locations', {
				...base,
				name: 'Behala warehouse',
				shortCode: 'BHL',
				warehouse: true,
				store: false,
				office: false,
				shipsOnline: true,
				address: '12 Diamond Harbour Road',
				pin: '700034',
				city: 'Kolkata',
				counterCashBox: false,
			});
			ctx.storeId = store.id;
			ctx.warehouseId = warehouse.id;
			const features = await admin.ok('GET', '/admin/company/features');
			const on = Object.fromEntries(
				[
					'locations',
					'stores',
					'business_accounts',
					'cash_on_delivery',
					'reverse_charge',
					'fixed_assets',
					'payroll',
					'pf',
					'esi',
					'gratuity',
					'lwf',
					'tds',
					'tax_invoices',
				].map((k) => [k, true]),
			);
			await admin.ok('PUT', '/admin/company/features', {
				on,
				expectedUpdatedAt: features?.updatedAt ?? features?.switches?.updatedAt ?? null,
			});
			return `store ${store.id}, warehouse ${warehouse.id}`;
		},
	},
	{
		name: 'Set up the books from the proprietorship templates',
		async run({ admin, check }) {
			await admin.ok('POST', '/admin/accounts/templates/set-up-books');
			const chart = await admin.ok('GET', '/admin/accounts/chart');
			ctx.chart = chart;
			const keys = new Set(chart.ledgers.map((l) => l.systemKey).filter(Boolean));
			for (const k of [
				'cash',
				'sales',
				'output_cgst',
				'output_sgst',
				'input_cgst',
				'debtors_control',
				'creditors_control',
				'capital',
				'profit_and_loss',
			])
				check(keys.has(k), `The chart has the ${k} ledger`);
			const again = await admin.try('POST', '/admin/accounts/templates/set-up-books');
			check(again.status === 409, 'Setting the books up twice is refused', `status ${again.status}`);
			return `${chart.groups.length} groups, ${chart.ledgers.length} ledgers`;
		},
	},
	{
		name: 'HDFC current account, then opening balances brought in from a trial balance (Import)',
		async run({ admin, check }) {
			const bank = await admin.ok('POST', '/admin/accounts/banks', {
				kind: 'current',
				ifsc: 'HDFC0001234',
				bankName: 'HDFC Bank',
				branch: 'Gariahat',
				holder: 'KR Marketing Test',
				number: '50200012344821',
				shortName: 'HDFC current',
				limitINR: null,
				ratePercent: null,
				maturesOn: null,
				locationId: ctx.storeId,
				openingINR: 0,
				openingOn: null,
				chequeFrom: '',
				chequeTo: '',
				upiIds: [],
				active: true,
			});
			ctx.bankId = bank.id;
			// Where money lands: bank transfers in and supplier payments out go through HDFC; UPI, gateway and cash
			// on delivery keep their clearing ledgers.
			await admin.ok('PUT', '/admin/accounts/money-landing', {
				receivedByGateway: null,
				receivedByUpi: null,
				receivedByBank: bank.ledgerId,
				cashOnDelivery: null,
				paidByBank: bank.ledgerId,
				paidInCash: null,
			});
			ctx.chart = await admin.ok('GET', '/admin/accounts/chart');
			const bankLedger = ctx.chart.ledgers.find((l) => l.id === bank.ledgerId);
			ctx.bankLedgerId = bank.ledgerId;
			const cash = ctx.chart.ledgers.find((l) => l.systemKey === 'cash');
			const capital = ctx.chart.ledgers.find((l) => l.systemKey === 'capital');
			// Opening, as at 31 March 2026: cash ₹20,000 and bank ₹4,80,000 against capital ₹5,00,000.
			const csv = [
				'Ledger,Group,Debit,Credit',
				`${cash.name},Cash-in-Hand,20000,`,
				`"${bankLedger.name}",Bank Accounts,480000,`,
				`${capital.name},Capital Account,,500000`,
			].join('\n');
			const input = {
				source: 'template_csv',
				start: 'year_start',
				startOn: '2026-04-01',
				fileName: 'opening.csv',
				text: csv,
			};
			const preview = await admin.ok('POST', '/admin/accounts/import/check', input);
			check(
				preview.balanced && preview.debitPaise === 50_000_000,
				'The opening trial balance balances at ₹5,00,000',
				`${preview.debitPaise}`,
			);
			check(
				preview.rows.every((r) => r.how === 'by_name'),
				'Every opening ledger matched ours by name',
				preview.rows.map((r) => r.how).join(','),
			);
			const unbalanced = await admin.try('POST', '/admin/accounts/import', {
				...input,
				text: csv.replace('500000', '499000'),
				locationId: ctx.storeId,
			});
			check(
				unbalanced.status === 400 && unbalanced.code === 'import_not_balanced',
				'An unbalanced file is refused',
				unbalanced.code,
			);
			const done = await admin.ok('POST', '/admin/accounts/import', { ...input, locationId: ctx.storeId });
			ctx.importId = done.id;
			const balances = await admin.ok('GET', '/admin/accounts/balances', undefined, { on: '2026-04-01' });
			check((balances[cash.id] ?? 0) === 2_000_000, 'Cash opens at ₹20,000 Dr', String(balances[cash.id]));
			check(
				(balances[bank.ledgerId] ?? 0) === 48_000_000,
				'HDFC opens at ₹4,80,000 Dr',
				String(balances[bank.ledgerId]),
			);
			check(
				(balances[capital.id] ?? 0) === -50_000_000,
				'Capital opens at ₹5,00,000 Cr',
				String(balances[capital.id]),
			);
			const total = Object.values(balances).reduce((a, b) => a + b, 0);
			check(total === 0, 'The trial balance on 1 April balances', String(total));
			return `opening journal ${done.voucherId}`;
		},
	},
	{
		name: 'Purchases: a West Bengal supplier’s bill in August (20 sarees at ₹3,000 + 5% GST), paid from HDFC in September',
		async run({ admin, check }) {
			ctx.variant = await variantOf('prd_1001');
			await setProductHsn('prd_1001', '5007');
			const supplier = await admin.ok('POST', '/admin/suppliers', {
				legalName: 'Tantuja Weavers Test Pvt Ltd',
				shortName: 'Tantuja Test',
				kind: 'regular',
				gstin: gstin('19', 'AAACT1234B'),
				pan: null,
				stateCode: '19',
				address: { line: '7 Bowbazar Street', city: 'Kolkata', pin: '700012' },
				contactName: 'Ravi',
				phone: '+91 9830000000',
				email: null,
				paymentTermsDays: 30,
				usesItemCodes: false,
				notes: '',
				active: true,
			});
			ctx.supplierId = supplier.id;
			const entry = await admin.ok('POST', '/admin/purchases/entries', {
				supplierId: supplier.id,
				purchaseOrderId: null,
				billNumber: 'TW-0805',
				billDate: '2026-08-05',
				goodsReceivedOn: '2026-08-05',
				pricesIncludeGst: false,
				freightINR: 0,
				freightGstRatePct: 0,
				roundOffINR: 0,
				printedTotalINR: 63_000,
				billAttachmentAssetId: null,
				lines: [
					{
						variantId: ctx.variant.id,
						quantity: 20,
						unitPriceINR: 3000,
						gstRatePct: 5,
						hsnOnBill: null,
						supplierItemCode: '',
					},
				],
			});
			const line = entry.lines[0].lineId;
			await admin.ok('POST', `/admin/purchases/entries/${entry.id}/goods-check`, {
				lines: [
					{
						lineId: line,
						accepted: 20,
						damaged: 0,
						missing: 0,
						damageReason: null,
						damageNote: '',
						damagePhotoAssetIds: [],
					},
				],
			});
			const preview = await admin.ok('GET', `/admin/purchases/entries/${entry.id}/post-preview`);
			await admin.ok('POST', `/admin/purchases/entries/${entry.id}/post`, {
				acceptWarningCodes: (preview.warnings ?? []).map((w) => w.code),
				requestKey: key('post'),
			});
			ctx.entryId = entry.id;
			const chart = (ctx.chart = await admin.ok('GET', '/admin/accounts/chart'));
			const aug = await admin.ok('GET', '/admin/accounts/balances', undefined, { on: '2026-08-31' });
			// ₹60,000 taxable, CGST ₹1,500 and SGST ₹1,500 (intra-state), ₹63,000 owed to the supplier.
			check(
				balanceOf(chart, aug, 'creditors_control') === -6_300_000,
				'The supplier is owed ₹63,000 at 31 August',
				String(balanceOf(chart, aug, 'creditors_control')),
			);
			check(
				balanceOf(chart, aug, 'input_cgst') === 150_000,
				'Input CGST ₹1,500',
				String(balanceOf(chart, aug, 'input_cgst')),
			);
			check(
				balanceOf(chart, aug, 'input_sgst') === 150_000,
				'Input SGST ₹1,500',
				String(balanceOf(chart, aug, 'input_sgst')),
			);
			check(
				balanceOf(chart, aug, 'input_igst') === 0,
				'No IGST on an intra-state bill',
				String(balanceOf(chart, aug, 'input_igst')),
			);
			check(
				balanceOf(chart, aug, 'stock_in_hand') === 6_000_000,
				'Stock in hand up ₹60,000 at cost',
				String(balanceOf(chart, aug, 'stock_in_hand')),
			);
			check(Object.values(aug).reduce((a, b) => a + b, 0) === 0, 'The trial balance at 31 August balances');
			await admin.ok('POST', `/admin/purchases/entries/${entry.id}/payments`, {
				amountINR: 63_000,
				paidOn: '2026-09-10',
				mode: 'bank_transfer',
				reference: 'NEFT-E2E-0910',
				proofAssetId: null,
			});
			const sep = await admin.ok('GET', '/admin/accounts/balances', undefined, { on: '2026-09-30' });
			check(
				balanceOf(chart, sep, 'creditors_control') === 0,
				'Nothing owed to the supplier after the payment',
				String(balanceOf(chart, sep, 'creditors_control')),
			);
			check((sep[ctx.bankLedgerId] ?? 0) === 41_700_000, 'HDFC down to ₹4,17,000', String(sep[ctx.bankLedgerId]));
			return `entry ${entry.id}`;
		},
	},
	{
		name: 'Sale 1: a shop customer buys 2 sarees by UPI; shipped 15 Sep, delivered 18 Sep',
		async run({ admin, check }) {
			const customer = await admin.ok('POST', '/admin/customers', {
				displayName: 'Ananya Test',
				email: `ananya-${key('c')}@example.test`,
				phone: '+91 9830012345',
				activationChannels: ['email'],
			});
			await admin.ok('POST', `/admin/customers/${customer.id}/address-book`, {
				fullName: 'Ananya Test',
				line1: '3 Southern Avenue',
				city: 'Kolkata',
				state: 'West Bengal',
				subdivisionCode: 'WB',
				postalCode: '700029',
				countryCode: 'IN',
				mobile: { countryCallingCode: '91', number: '9830012345' },
				label: 'Home',
				isDefault: true,
			});
			const addresses = await admin.ok('GET', '/admin/orders/buyer-addresses', undefined, {
				kind: 'person',
				id: customer.id,
			});
			const buyer = { kind: 'person', customerId: customer.id };
			const base = {
				cart: {
					buyer,
					currency: 'INR',
					lines: [{ productId: 'prd_1001', variationId: null, quantity: 2, addons: [] }],
				},
				delivery: { kind: 'saved', savedAddressId: addresses[0].id },
				billing: null,
				indianInvoiceAddress: null,
				couponCodes: [],
				comment: null,
			};
			const quote = await admin.ok('POST', '/admin/orders/checkout/quote', {
				...base,
				payment: {
					method: 'manual',
					payment: {
						method: 'upi',
						amountINR: 1,
						reference: 'X',
						receivedOn: '2026-09-12',
						received: true,
						note: null,
						proofMediaId: null,
						collector: null,
						collectedBy: null,
					},
				},
				idempotencyKey: key('q'),
			});
			ctx.sale1Quote = quote.totals;
			const created = await admin.ok('POST', '/admin/orders', {
				...base,
				payment: {
					method: 'manual',
					payment: {
						method: 'upi',
						amountINR: quote.totals.totalINR,
						reference: '402112345678',
						receivedOn: '2026-09-12',
						received: true,
						note: null,
						proofMediaId: null,
						collector: null,
						collectedBy: null,
					},
				},
				idempotencyKey: key('o1'),
			});
			const orderId = created.order?.id ?? created.id;
			ctx.order1 = orderId;
			const move = async (to, extra = {}) => {
				let now = await admin.ok('GET', `/admin/orders/${orderId}`);
				if (to === 'packed')
					for (const line of now.order.lines) {
						if (!line.lineId || line.role === 'bundle' || (now.order.packTicks ?? []).includes(line.lineId))
							continue;
						now = await admin.ok('PUT', `/admin/orders/${orderId}/pack-ticks`, {
							lineId: line.lineId,
							ticked: true,
							revision: now.order.revision,
						});
					}
				return admin.ok('POST', `/admin/orders/${orderId}/status`, {
					to,
					revision: now.order.revision,
					...extra,
				});
			};
			await move('processing');
			await move('packed');
			await move('shipped', { shipped: { courierName: 'DTDC', trackingNumber: 'D1', shippedOn: '2026-09-15' } });
			const done = await move('delivered', { delivered: { deliveredOn: '2026-09-18', receivedBy: 'Ananya' } });
			const [invoice] = await admin.ok('GET', `/admin/orders/${orderId}/invoices`);
			ctx.invoice1 = invoice;
			check(done.order.status === 'delivered', 'The order is delivered');
			check(
				quote.totals.totalINR === 9360,
				'Two sarees at ₹4,680 come to ₹9,360 with no delivery charge',
				String(quote.totals.totalINR),
			);
			check(
				invoice.date === '2026-09-15',
				'The tax invoice is dated the day the goods left (15 Sep)',
				invoice.date,
			);
			check(invoice.number === 'TI/26-27/000001', 'It is the first tax invoice of 2026-27', invoice.number);
			check(
				invoice.seller.name === 'Saha Textile Test',
				'The seller is named, not shown as a GSTIN',
				invoice.seller.name,
			);
			check(
				!invoice.interState && invoice.placeOfSupply === '19',
				'Intra-state, place of supply West Bengal (19)',
			);
			// Tax included at 5%: taxable 9,360 ÷ 1.05 = ₹8,914.29, tax ₹445.71 split into CGST and SGST.
			check(invoice.taxableINR === 8914.29, 'Taxable ₹8,914.29', String(invoice.taxableINR));
			check(
				Math.round((invoice.cgstINR + invoice.sgstINR) * 100) === 44_571,
				'CGST + SGST ₹445.71',
				`${invoice.cgstINR} + ${invoice.sgstINR}`,
			);
			check(
				Math.abs(Math.round(invoice.cgstINR * 100) - Math.round(invoice.sgstINR * 100)) <= 1,
				'CGST and SGST split in half (a paisa apart at most)',
			);
			check(invoice.igstINR === 0, 'No IGST');
			const chart = ctx.chart;
			const sep = await admin.ok('GET', '/admin/accounts/balances', undefined, { on: '2026-09-30' });
			ctx.sep = sep;
			check(
				balanceOf(chart, sep, 'sales') === -891_429,
				'Sales ₹8,914.29 Cr in September',
				String(balanceOf(chart, sep, 'sales')),
			);
			check(
				balanceOf(chart, sep, 'output_cgst') + balanceOf(chart, sep, 'output_sgst') === -44_571,
				'Output GST ₹445.71 Cr',
			);
			check(
				balanceOf(chart, sep, 'cost_of_goods_sold') === 600_000,
				'Cost of goods sold ₹6,000 (2 × ₹3,000)',
				String(balanceOf(chart, sep, 'cost_of_goods_sold')),
			);
			check(
				balanceOf(chart, sep, 'stock_in_hand') === 5_400_000,
				'Stock in hand ₹54,000 (18 left at ₹3,000)',
				String(balanceOf(chart, sep, 'stock_in_hand')),
			);
			check(
				balanceOf(chart, sep, 'upi_card_clearing') === 936_000,
				'UPI clearing holds the ₹9,360 received',
				String(balanceOf(chart, sep, 'upi_card_clearing')),
			);
			check(
				balanceOf(chart, sep, 'customer_advances') === 0 && balanceOf(chart, sep, 'debtors_control') === 0,
				'No advance or amount due left on the customer',
			);
			check(Object.values(sep).reduce((a, b) => a + b, 0) === 0, 'The trial balance at 30 September balances');
			return `invoice ${invoice.number}`;
		},
	},
	{
		name: 'Sale 2: a Mumbai customer buys 1 saree by bank transfer (2 Oct); shipped 5 Oct: IGST',
		async run({ admin, check }) {
			const customer = await customerWith(admin, 'Rohan Test', {
				fullName: 'Rohan Test',
				line1: '14 Marine Drive',
				city: 'Mumbai',
				state: 'Maharashtra',
				subdivisionCode: 'MH',
				postalCode: '400020',
				countryCode: 'IN',
				mobile: { countryCallingCode: '91', number: '9820012345' },
			});
			const { invoice } = await sell(admin, {
				customer,
				quantity: 1,
				payment: {
					method: 'bankTransfer',
					amountINR: 4680,
					reference: 'UTR20261002',
					receivedOn: '2026-10-02',
				},
				shippedOn: '2026-10-05',
				deliveredOn: '2026-10-08',
			});
			ctx.invoice2 = invoice;
			check(
				invoice.date === '2026-10-05' && invoice.number === 'TI/26-27/000002',
				'Invoice TI/26-27/000002 dated 5 Oct',
				`${invoice.number} ${invoice.date}`,
			);
			check(
				invoice.interState && invoice.placeOfSupply === '27',
				'Inter-state, place of supply Maharashtra (27)',
				invoice.placeOfSupply,
			);
			// ₹4,680 ÷ 1.05 = ₹4,457.14 taxable, IGST ₹222.86.
			check(
				invoice.taxableINR === 4457.14 && invoice.igstINR === 222.86 && invoice.cgstINR === 0,
				'Taxable ₹4,457.14, IGST ₹222.86',
				`${invoice.taxableINR} / ${invoice.igstINR}`,
			);
			const chart = ctx.chart;
			const oct = await admin.ok('GET', '/admin/accounts/balances', undefined, { on: '2026-10-31' });
			check(
				balanceOf(chart, oct, 'sales') === -1_337_143,
				'Sales ₹13,371.43 Cr by 31 Oct (₹8,914.29 + ₹4,457.14)',
				String(balanceOf(chart, oct, 'sales')),
			);
			check(
				balanceOf(chart, oct, 'output_igst') === -22_286,
				'Output IGST ₹222.86 Cr',
				String(balanceOf(chart, oct, 'output_igst')),
			);
			check(
				(oct[ctx.bankLedgerId] ?? 0) === 42_168_000,
				'HDFC ₹4,21,680 after the transfer',
				String(oct[ctx.bankLedgerId]),
			);
			check(
				balanceOf(chart, oct, 'cost_of_goods_sold') === 900_000,
				'Cost of goods sold ₹9,000 (3 sarees)',
				String(balanceOf(chart, oct, 'cost_of_goods_sold')),
			);
			check(sumBalances(oct) === 0, 'The trial balance at 31 October balances');
			return invoice.number;
		},
	},
	{
		name: 'A return: Ananya sends 1 saree back; checked into stock; credit note issued; refunded from HDFC',
		async run({ admin, check }) {
			const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
			const old = await admin.ok('GET', `/admin/orders/${ctx.order1}`);
			const oldLine = old.order.lines.find((l) => l.lineId && l.role !== 'bundle').lineId;
			const late = await admin.try('POST', `/admin/orders/${ctx.order1}/returns`, {
				lines: [{ lineId: oldLine, quantity: 1 }],
				reason: 'size_or_fit',
				how: 'customer_sends',
				refundTo: 'bank_transfer',
				note: '',
			});
			check(
				late.code === 'return_window_closed',
				'A September sale can no longer come back (return window closed)',
				late.code,
			);
			// Sale 3 today, by UPI, then returned.
			const customer = await customerWith(admin, 'Mitali Test', {
				fullName: 'Mitali Test',
				line1: '9 Lake Road',
				city: 'Kolkata',
				state: 'West Bengal',
				subdivisionCode: 'WB',
				postalCode: '700029',
				countryCode: 'IN',
				mobile: { countryCallingCode: '91', number: '9830054321' },
			});
			const sale3 = await sell(admin, {
				customer,
				quantity: 1,
				payment: { method: 'upi', amountINR: 4680, reference: '402199998888', receivedOn: today },
				shippedOn: today,
				deliveredOn: today,
			});
			check(
				sale3.invoice.number === 'TI/26-27/000003',
				'Sale 3 invoiced as TI/26-27/000003',
				sale3.invoice.number,
			);
			const order = await admin.ok('GET', `/admin/orders/${sale3.orderId}`);
			const lineId = order.order.lines.find((l) => l.lineId && l.role !== 'bundle').lineId;
			const back = await admin.ok('POST', `/admin/orders/${sale3.orderId}/returns`, {
				lines: [{ lineId, quantity: 1 }],
				reason: 'size_or_fit',
				how: 'customer_sends',
				refundTo: 'bank_transfer',
				note: '',
			});
			const returnId = back.id ?? back.return?.id;
			await admin.ok('POST', `/admin/returns/${returnId}/step`, { to: 'received' });
			await admin.ok('POST', `/admin/returns/${returnId}/check`, {
				lines: [{ lineId, outcome: 'restock', note: '' }],
			});
			const draft = await admin.ok('POST', `/admin/returns/${returnId}/credit-note`);
			const noteId = draft.id ?? draft.creditNote?.id;
			const issued = await admin.ok('POST', `/admin/accounts/credit-notes/${noteId}/issue`, {
				version: draft.version ?? 0,
			});
			const note = issued.creditNote ?? issued;
			ctx.creditNote = note;
			// One saree back: taxable ₹4,457.14, CGST + SGST ₹222.86.
			check(note.taxableINR === 4457.14, 'Credit note taxable ₹4,457.14', String(note.taxableINR));
			check(
				Math.round((note.cgstINR + note.sgstINR) * 100) === 22_286,
				'Credit note CGST + SGST ₹222.86',
				`${note.cgstINR} + ${note.sgstINR}`,
			);
			await admin.ok('POST', `/admin/accounts/credit-notes/${noteId}/refund`, {
				how: 'by_hand',
				method: 'bank_transfer',
				ledgerId: ctx.bankLedgerId,
				reference: 'NEFT-REFUND-1',
			});
			const chart = ctx.chart;
			const now = await admin.ok('GET', '/admin/accounts/balances', undefined, { on: today });
			ctx.afterReturn = now;
			// Three sales (₹8,914.29 + ₹4,457.14 + ₹4,457.14 taxable), one returned.
			check(
				balanceOf(chart, now, 'sales') === -1_782_857,
				'Sales ₹17,828.57 Cr',
				String(balanceOf(chart, now, 'sales')),
			);
			check(
				balanceOf(chart, now, 'sales_returns') === 445_714,
				'Sales returns ₹4,457.14 Dr',
				String(balanceOf(chart, now, 'sales_returns')),
			);
			check(
				balanceOf(chart, now, 'output_cgst') + balanceOf(chart, now, 'output_sgst') === -44_571,
				'Output CGST + SGST back to ₹445.71 Cr (sale 3 and its return cancel)',
				String(balanceOf(chart, now, 'output_cgst') + balanceOf(chart, now, 'output_sgst')),
			);
			check(
				balanceOf(chart, now, 'cost_of_goods_sold') === 900_000,
				'Cost of goods sold ₹9,000 (4 sold, 1 back)',
				String(balanceOf(chart, now, 'cost_of_goods_sold')),
			);
			check(
				balanceOf(chart, now, 'stock_in_hand') === 5_100_000,
				'Stock in hand ₹51,000 (17 sarees)',
				String(balanceOf(chart, now, 'stock_in_hand')),
			);
			check(
				balanceOf(chart, now, 'upi_card_clearing') === 1_404_000,
				'UPI clearing ₹14,040 (sales 1 and 3)',
				String(balanceOf(chart, now, 'upi_card_clearing')),
			);
			check(
				(now[ctx.bankLedgerId] ?? 0) === 41_700_000,
				'HDFC ₹4,17,000 after the ₹4,680 refund',
				String(now[ctx.bankLedgerId]),
			);
			check(
				balanceOf(chart, now, 'debtors_control') === 0 && balanceOf(chart, now, 'customer_advances') === 0,
				'Nothing left owed by or to the customer',
			);
			check(sumBalances(now) === 0, 'The trial balance balances after the return');
			return note.number;
		},
	},
	{
		name: 'GST returns: GSTR-1 September and October against the invoices, filed; September then locked; GSTR-3B',
		async run({ admin, check }) {
			const prepare = (returnType, month) =>
				admin.ok('POST', '/admin/accounts/gst/returns', {
					gstRegistrationId: ctx.registrationId,
					returnType,
					month,
					adjustments: [],
				});
			const table = (draft, name) => draft.summary.find((r) => r.table === name);
			const sep1 = await prepare('GSTR-1', '2026-09');
			// Table 7 (B2C, intra-state) and table 12 (HSN summary) each carry the one September invoice.
			check(
				table(sep1, '7')?.taxable === 8914.29 && table(sep1, '7')?.tax === 445.71,
				'GSTR-1 September table 7: ₹8,914.29 taxable, ₹445.71 tax',
				JSON.stringify(table(sep1, '7')),
			);
			check(
				table(sep1, '12')?.taxable === 8914.29,
				'GSTR-1 September table 12 (HSN 5007) agrees',
				JSON.stringify(table(sep1, '12')),
			);
			check(sep1.problems.length === 0, 'No problems in September', JSON.stringify(sep1.problems));
			const oct1 = await prepare('GSTR-1', '2026-10');
			check(
				table(oct1, '7')?.taxable === 4457.14 && table(oct1, '7')?.tax === 222.86,
				'GSTR-1 October table 7: ₹4,457.14 inter-state, IGST ₹222.86',
				JSON.stringify(table(oct1, '7')),
			);
			const early3b = await admin.try('POST', '/admin/accounts/gst/returns', {
				gstRegistrationId: ctx.registrationId,
				returnType: 'GSTR-3B',
				month: '2026-09',
				adjustments: [],
			});
			check(early3b.code === 'gst_gstr1_not_filed', 'GSTR-3B waits for GSTR-1 to be filed', early3b.code);
			let draft = sep1;
			for (const to of ['checked', 'approved'])
				draft = await admin.ok('POST', `/admin/accounts/gst/returns/${draft.id}/step`, {
					to,
					version: draft.version ?? 0,
				});
			await admin.ok('POST', '/admin/accounts/gst-filings', {
				gstRegistrationId: ctx.registrationId,
				returnType: 'GSTR-1',
				month: '2026-09',
				arn: 'AA1910260012345',
				filedOn: '2026-10-11',
				acknowledgement: null,
			});
			// Filed: September's sales lock for this GSTIN. A sale shipped on a September day is refused.
			const customer = await customerWith(admin, 'Late Test', {
				fullName: 'Late Test',
				line1: '1 Park Street',
				city: 'Kolkata',
				state: 'West Bengal',
				subdivisionCode: 'WB',
				postalCode: '700016',
				countryCode: 'IN',
				mobile: { countryCallingCode: '91', number: '9830011111' },
			});
			let refused = null;
			try {
				await sell(admin, {
					customer,
					quantity: 1,
					payment: { method: 'upi', amountINR: 4680, reference: '402100000001', receivedOn: '2026-09-20' },
					shippedOn: '2026-09-20',
					deliveredOn: '2026-09-22',
				});
			} catch (error) {
				refused = String(error.message);
			}
			check(
				!!refused && /lock|filed|closed/.test(refused),
				'A sale dated into filed September is refused',
				(refused ?? 'accepted').slice(0, 200),
			);
			const sep3 = await prepare('GSTR-3B', '2026-09');
			ctx.gstr3bSep = sep3;
			const outward = sep3.summary.find((r) => /3\.?1.?a/i.test(r.table));
			check(
				outward?.taxable === 8914.29 && outward?.tax === 445.71,
				'GSTR-3B September 3.1(a): ₹8,914.29 taxable, ₹445.71 tax',
				JSON.stringify(sep3.summary.slice(0, 3)),
			);
			return `3B rows ${sep3.summary.map((r) => r.table).join(',')}`;
		},
	},
	{
		name: 'Statements: profit and loss, balance sheet and ratios for the year to date, against hand figures',
		async run({ admin, check }) {
			const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
			// Sales ₹17,828.57 less returns ₹4,457.14 = ₹13,371.43; cost of goods ₹9,000: profit ₹4,371.43.
			const pl = await admin.ok('GET', '/admin/accounts/reports/statements/profitLoss', undefined, {
				asAt: today,
			});
			const plText = JSON.stringify(pl);
			check(pl.problems?.length === 0, 'The profit and loss layout has no problems', JSON.stringify(pl.problems));
			check(
				plText.includes('437143') || plText.includes('4371.43'),
				'Profit for the year ₹4,371.43',
				plText.slice(0, 300),
			);
			const bs = await admin.ok('GET', '/admin/accounts/reports/statements/balanceSheet', undefined, {
				asAt: today,
			});
			const bsText = JSON.stringify(bs);
			check(bs.problems?.length === 0, 'The balance sheet layout has no problems', JSON.stringify(bs.problems));
			// Assets: cash 20,000 + HDFC 4,17,000 + UPI clearing 18,720 (sales 1 and 3, and the refused late sale's
			// ₹4,680 still held as the customer's advance) + stock 51,000 = ₹5,06,720. Funds and liabilities: capital
			// 5,00,000 + profit 4,371.43 + advance 4,680 − GST 2,331.43 (input 3,000 net of output 668.57) = ₹5,06,720.
			const total = (key) => bs.rows.find((r) => r.key === key)?.thisYearPaise;
			check(
				total('funds_and_liabilities') === 50_672_000,
				'Funds and liabilities ₹5,06,720',
				String(total('funds_and_liabilities')),
			);
			check(
				bs.rows.filter((r) => r.depth === 0).every((r) => r.thisYearPaise === 50_672_000),
				'Both sides of the balance sheet ₹5,06,720',
				bs.rows
					.filter((r) => r.depth === 0)
					.map((r) => `${r.key} ${r.thisYearPaise}`)
					.join(', '),
			);
			const ratios = await admin.ok('GET', '/admin/accounts/reports/ratios', undefined, {
				from: '2026-04-01',
				to: today,
			});
			// Gross margin = 4,371.43 ÷ 13,371.43 = 32.69%.
			check(ratios.values.grossMargin === 32.69, 'Gross margin 32.69%', String(ratios.values.grossMargin));
			const cash = await admin.ok('GET', '/admin/accounts/reports/cash-flow', undefined, {
				from: '2026-04-01',
				to: today,
			});
			// Cash and bank opened at ₹5,00,000 (brought in on 31 March) and stand at ₹4,37,000.
			check(
				cash.closingCash - cash.openingCash === cash.netChange,
				'Cash flow: the lines add up to the change in cash',
				`${cash.netChange}`,
			);
			const tb = await admin.ok('GET', '/admin/accounts/export', undefined, {
				format: 'trial_balance_csv',
				from: '2026-04-01',
				to: today,
			});
			const back = await admin.ok('POST', '/admin/accounts/import/check', {
				source: 'template_csv',
				start: 'date',
				startOn: today,
				fileName: tb.fileName,
				text: tb.text,
			});
			check(
				back.balanced && back.rows.every((r) => r.how === 'by_name'),
				'The exported trial balance reads straight back in, balanced, every ledger matched',
				`${back.debitPaise}/${back.creditPaise}`,
			);
			return `profit and balance sheet checked`;
		},
	},
	{
		name: 'Locks: August locked; a journal dated in August is refused; reopened by the super admin, it posts',
		async run({ admin, check }) {
			const parts = ['sales', 'purchases', 'stock', 'cash', 'bank', 'journal', 'payroll'];
			await admin.ok('POST', '/admin/accounts/periods', {
				months: ['2026-08'],
				parts,
				state: 'locked',
				reason: 'August checked and closed',
			});
			const cash = ctx.chart.ledgers.find((l) => l.systemKey === 'cash');
			const journal = (key) => ({
				kind: 'contra',
				date: '2026-08-20',
				narration: 'Cash deposited',
				lines: [
					{
						ledgerId: ctx.bankLedgerId,
						locationId: ctx.storeId,
						debitPaise: 100_000,
						creditPaise: 0,
						narration: '',
					},
					{ ledgerId: cash.id, locationId: ctx.storeId, debitPaise: 0, creditPaise: 100_000, narration: '' },
				],
				reverseOn: null,
				attachments: [],
				idempotencyKey: key,
				draftId: null,
			});
			const refused = await admin.try('POST', '/admin/accounts/vouchers', journal(key('j1')));
			check(
				refused.status >= 400,
				'A contra dated in locked August is refused',
				`${refused.status} ${refused.code}`,
			);
			await admin.ok('POST', '/admin/accounts/periods', {
				months: ['2026-08'],
				parts,
				state: 'open',
				reason: 'A deposit was missed',
			});
			const posted = await admin.ok('POST', '/admin/accounts/vouchers', journal(key('j2')));
			check(!!posted.id, 'Reopened, the same contra posts', posted.number);
			const aug = await admin.ok('GET', '/admin/accounts/balances', undefined, { on: '2026-08-31' });
			check(
				(aug[ctx.bankLedgerId] ?? 0) === 48_100_000 && (aug[cash.id] ?? 0) === 1_900_000,
				'HDFC ₹4,81,000 and cash ₹19,000 at 31 August',
				`${aug[ctx.bankLedgerId]} / ${aug[cash.id]}`,
			);
			return posted.number;
		},
	},
	{
		name: 'Permissions: a store manager may not lock months, read the edit log or close the year',
		async run({ admin, check }) {
			const email = 'manager-e2e@example.test';
			const password = 'Accounts-E2E-Manager-2026!';
			const userId = await secondAdmin(email, password);
			// A store manager: books and documents, but neither locking nor templates.
			const manager = await admin.ok('POST', '/admin/roles', {
				key: 'store-manager-e2e',
				label: 'Store manager (test)',
				description: null,
				baseRole: 'admin',
				permissions: ['accounts.index', 'accounts.edit', 'accounts.post'],
			});
			const authority = await admin.ok('GET', `/admin/users/${userId}/authority`);
			for (const role of authority.roles ?? [])
				await admin.try('DELETE', `/admin/users/${userId}/roles/${role.id ?? role.roleId}`);
			await admin.ok('POST', `/admin/users/${userId}/roles`, { roleId: manager.id });
			const staff = new Admin('store manager');
			await staff.signIn(email, password);
			const lock = await staff.try('POST', '/admin/accounts/periods', {
				months: ['2026-09'],
				parts: ['sales'],
				state: 'locked',
				reason: 'Trying to lock',
			});
			check(lock.status === 403, 'Locking a month is refused (403)', String(lock.status));
			const audit = await staff.try('GET', '/admin/accounts/reports/audit', undefined, {
				from: '2026-04-01',
				to: '2026-11-30',
			});
			check(audit.status === 403, 'The edit log is refused (403)', String(audit.status));
			const close = await staff.try('POST', '/admin/accounts/year-close/2026-27/close');
			check(close.status === 403, 'Closing the year is refused (403)', String(close.status));
			const rules = await staff.try('POST', '/admin/payroll/rules', {});
			check(
				rules.status === 403 || rules.status === 400,
				'Adding payroll rules is refused',
				String(rules.status),
			);
			return 'store manager refused';
		},
	},
];

export const helpers = { balanceOf, rupees };
