/**
 * The accounts run's scenarios, in order; each builds on the ones before through `ctx`. Figures are worked out by
 * hand in the comments and checked against what the books say. Dates are spread over FY 2026-27 so past months'
 * GST and reports are checked too.
 */

import { variantOf } from './stack.mjs';

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
];

export const helpers = { balanceOf, rupees };
