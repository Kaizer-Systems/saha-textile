/**
 * The accounts run's scenarios, in order; each builds on the ones before through `ctx`. Figures are worked out by
 * hand in the comments and checked against what the books say. Dates are spread over FY 2026-27 so past months'
 * GST and reports are checked too.
 */

import { Admin } from './client.mjs';
import { secondAdmin, setProductHsn, variantOf } from './stack.mjs';

/**
 * The kind of business the run sets up (owner, 25 Nov: every kind checked from opening to year close). A
 * proprietorship, LLP and private limited file monthly; the partnership files quarterly (QRMP) and has an input service
 * distributor in Maharashtra; the one person company is under composition.
 */
export const KIND = process.env.ACCOUNTS_E2E_KIND ?? 'proprietorship';
const KINDS = ['proprietorship', 'partnership', 'llp', 'private_limited', 'private_limited_opc'];
if (!KINDS.includes(KIND)) throw new Error(`ACCOUNTS_E2E_KIND must be one of ${KINDS.join(', ')}`);
export const COMPOSITION = KIND === 'private_limited_opc';
export const QRMP = KIND === 'partnership';
const PARTNERS = KIND === 'partnership' || KIND === 'llp';
const COMPANY = KIND === 'private_limited' || KIND === 'private_limited_opc';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** A valid GSTIN: state, the PAN, the entity number (1 for the first registration in a State), Z, the check. */
export function gstin(state, pan, entity = '1') {
	const body = `${state}${pan}${entity}Z`;
	let total = 0;
	for (const [index, char] of [...body].entries()) {
		const value = ALPHABET.indexOf(char) * ((index % 2) + 1);
		total += Math.floor(value / 36) + (value % 36);
	}
	return body + ALPHABET[(36 - (total % 36)) % 36];
}

/** The business's PAN: its fourth letter is the kind of holder (P person, F firm or LLP, C company). */
export const PAN = {
	proprietorship: 'ABCPS1234K',
	partnership: 'ABCFS1234K',
	llp: 'ABCFL1234K',
	private_limited: 'ABCCS1234K',
	private_limited_opc: 'ABCCO1234K',
}[KIND];
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

/**
 * Hand figures, in paise, where composition differs: no input credit (each saree costs ₹3,150 with its GST), bills of
 * supply without tax (the whole ₹4,680 is the sale), no sale to Mumbai, and CMP-08's ₹93.60 tax (1% of ₹9,360) paid.
 */
const F = COMPOSITION
	? {
			inputHalf: 0,
			stockAug: 6_300_000,
			unitCost: 315_000,
			sale1Taxable: 9360,
			sale1Tax: 0,
			salesSep: -936_000,
			outputSep: 0,
			stockSep: 5_670_000,
			cogsSep: 630_000,
			sale3Number: 'TI/26-27/000002',
			noteTaxable: 4680,
			noteTax: 0,
			salesNow: -1_404_000,
			returnsNow: 468_000,
			outputNow: 0,
			cogsNow: 630_000,
			stockNow: 5_670_000,
			bankNow: 41_232_000,
		}
	: {
			inputHalf: 150_000,
			stockAug: 6_000_000,
			unitCost: 300_000,
			sale1Taxable: 8914.29,
			sale1Tax: 44_571,
			salesSep: -891_429,
			outputSep: -44_571,
			stockSep: 5_400_000,
			cogsSep: 600_000,
			sale3Number: 'TI/26-27/000003',
			noteTaxable: 4457.14,
			noteTax: 22_286,
			salesNow: -1_782_857,
			returnsNow: 445_714,
			outputNow: -44_571,
			cogsNow: 900_000,
			stockNow: 5_100_000,
			bankNow: 41_700_000,
		};

const balanceOf = (chart, balances, systemKey) => {
	const ledger = chart.ledgers.find((l) => l.systemKey === systemKey || (l.roles ?? []).includes(systemKey));
	return ledger ? (balances[ledger.id] ?? 0) : 0;
};

/** A sale shipped on a September day, after September's return is filed: refused (the month is locked). */
async function lateSaleRefused(admin, check) {
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
}

const prepareReturn = (admin, returnType, month, extra = {}) =>
	admin.ok('POST', '/admin/accounts/gst/returns', {
		gstRegistrationId: extra.gstRegistrationId ?? ctx.registrationId,
		returnType,
		month,
		adjustments: [],
		...extra,
	});
const approveReturn = async (admin, draft) => {
	let next = draft;
	for (const to of ['checked', 'approved'])
		next = await admin.ok('POST', `/admin/accounts/gst/returns/${next.id}/step`, {
			to,
			version: next.version ?? 0,
		});
	return next;
};
const tableOf = (draft, name) => draft.summary.find((r) => r.table === name);

/** QRMP (G1–G3): the calendar by quarter, the quarter's GSTR-1, IFF and PMT-06 in October, GSTR-3B for the quarter. */
async function qrmpGst(admin, check) {
	const calendar = await admin.ok('GET', '/admin/accounts/gst/returns/calendar', undefined, {
		gstRegistrationId: ctx.registrationId,
		chip: 'all',
	});
	const listed = new Set(calendar.rows.map((r) => `${r.returnType}:${r.period}`));
	check(
		listed.has('GSTR-1:2026-09') && listed.has('GSTR-3B:2026-09') && !listed.has('GSTR-1:2026-08'),
		'Quarterly: GSTR-1 and GSTR-3B fall due for the quarter ending September, not for August',
		[...listed].join(', '),
	);
	check(
		listed.has('IFF:2026-10') && listed.has('PMT-06:2026-10') && !listed.has('PMT-06:2026-09'),
		'IFF and PMT-06 fall due for October, a quarter’s first month, never for September',
	);
	const august = await admin.try('POST', '/admin/accounts/gst/returns', {
		gstRegistrationId: ctx.registrationId,
		returnType: 'GSTR-1',
		month: '2026-08',
		adjustments: [],
	});
	check(august.code === 'gst_return_quarter_end_only', 'A quarterly GSTR-1 for August is refused', august.code);
	const quarter1 = await prepareReturn(admin, 'GSTR-1', '2026-09');
	check(
		tableOf(quarter1, '7')?.taxable === 8914.29 && tableOf(quarter1, '7')?.tax === 445.71,
		'GSTR-1 for July–September, table 7: ₹8,914.29 taxable, ₹445.71 tax',
		JSON.stringify(tableOf(quarter1, '7')),
	);
	const iff = await prepareReturn(admin, 'IFF', '2026-10');
	check(
		tableOf(iff, '4A')?.records === 0 && iff.problems.length === 0,
		'IFF October: no B2B invoices to report (the Mumbai sale was to a person)',
		JSON.stringify(iff.summary),
	);
	// PMT-06 October by self-assessment: the Mumbai sale's IGST ₹222.86, no credit yet: ₹223 deposited.
	let pmt = await prepareReturn(admin, 'PMT-06', '2026-10', { pmt06Method: 'self_assessment' });
	check(tableOf(pmt, 'pmt06_igst')?.tax === 223, 'PMT-06 October: ₹223 IGST to deposit', JSON.stringify(pmt.summary));
	const fixedEarly = await prepareReturn(admin, 'PMT-06', '2026-11', { pmt06Method: 'fixed_sum' });
	check(
		fixedEarly.problems.some((p) => p.problem === 'pmt06_no_last_quarter'),
		'PMT-06 by fixed sum waits for the last quarter’s GSTR-3B',
		JSON.stringify(fixedEarly.problems),
	);
	pmt = await approveReturn(admin, pmt);
	pmt = await admin.ok('POST', `/admin/accounts/gst/returns/${pmt.id}/set-off`, {
		bankAccountId: ctx.bankId,
		paidOn: '2026-11-20',
		challan: 'CPIN26112000001',
		version: pmt.version,
	});
	const chart = (ctx.chart = await admin.ok('GET', '/admin/accounts/chart'));
	const now = await admin.ok('GET', '/admin/accounts/balances', undefined, { on: '2026-11-20' });
	check(
		balanceOf(chart, now, 'gst_cash_ledger') === 22_300,
		'The deposit sits in the GST cash ledger: ₹223',
		String(balanceOf(chart, now, 'gst_cash_ledger')),
	);
	check(!!pmt.challanVoucherId, 'The PMT-06 payment is posted once, from HDFC');
	await approveReturn(admin, quarter1);
	await admin.ok('POST', '/admin/accounts/gst-filings', {
		gstRegistrationId: ctx.registrationId,
		returnType: 'GSTR-1',
		month: '2026-09',
		arn: 'AA1910260012345',
		filedOn: '2026-10-13',
		acknowledgement: null,
	});
	await lateSaleRefused(admin, check);
	const quarter3b = await prepareReturn(admin, 'GSTR-3B', '2026-09');
	ctx.gstr3bSep = quarter3b;
	const outward = quarter3b.summary.find((r) => /3\.?1.?a/i.test(r.table));
	check(
		outward?.taxable === 8914.29 && outward?.tax === 445.71,
		'GSTR-3B for July–September 3.1(a): ₹8,914.29 taxable, ₹445.71 tax',
		JSON.stringify(quarter3b.summary.slice(0, 3)),
	);
	const fixed = await prepareReturn(admin, 'PMT-06', '2026-11', { pmt06Method: 'fixed_sum' });
	const deposit = fixed.summary.reduce((sum, row) => sum + row.tax, 0);
	check(
		fixed.problems.length === 0 && deposit > 0,
		'PMT-06 November by fixed sum: 35% of the quarter’s cash, rounded up by head',
		`${deposit} ${JSON.stringify(fixed.problems)}`,
	);
	return `quarterly returns checked`;
}

/** Composition (G2): CMP-08 by quarter, its tax booked and paid, the quarter locked, GSTR-4 waiting for the year. */
async function compositionGst(admin, check) {
	const calendar = await admin.ok('GET', '/admin/accounts/gst/returns/calendar', undefined, {
		gstRegistrationId: ctx.registrationId,
		chip: 'all',
	});
	const types = new Set(calendar.rows.map((r) => r.returnType));
	check(
		types.has('CMP-08') && !types.has('GSTR-1') && !types.has('GSTR-3B'),
		'Composition: CMP-08 is due each quarter; no GSTR-1 or GSTR-3B',
		[...types].join(', '),
	);
	const gstr1 = await admin.try('POST', '/admin/accounts/gst/returns', {
		gstRegistrationId: ctx.registrationId,
		returnType: 'GSTR-1',
		month: '2026-09',
		adjustments: [],
	});
	check(gstr1.code === 'gst_return_not_for_this_gstin', 'GSTR-1 is refused under composition', gstr1.code);
	let cmp = await prepareReturn(admin, 'CMP-08', '2026-09');
	// 1% of the quarter's ₹9,360: CGST ₹46.80 + SGST ₹46.80.
	check(
		tableOf(cmp, 'cmp_outward')?.taxable === 9360 && tableOf(cmp, 'cmp_total')?.tax === 93.6,
		'CMP-08 July–September: ₹9,360 turnover, ₹93.60 tax',
		JSON.stringify(cmp.summary),
	);
	cmp = await approveReturn(admin, cmp);
	const paid = await admin.ok('POST', `/admin/accounts/gst/returns/${cmp.id}/set-off`, {
		bankAccountId: ctx.bankId,
		paidOn: '2026-10-15',
		challan: 'CPIN26101500001',
		version: cmp.version,
	});
	check(!!paid.expenseVoucherId && !!paid.challanVoucherId, 'CMP-08: the tax booked and the challan paid, once');
	const chart = (ctx.chart = await admin.ok('GET', '/admin/accounts/chart'));
	const sep = await admin.ok('GET', '/admin/accounts/balances', undefined, { on: '2026-09-30' });
	check(
		balanceOf(chart, sep, 'composition_tax') === 9_360 &&
			balanceOf(chart, sep, 'composition_tax_payable') === -9_360,
		'The quarter’s composition tax is an expense at 30 September, owed until paid',
		`${balanceOf(chart, sep, 'composition_tax')} / ${balanceOf(chart, sep, 'composition_tax_payable')}`,
	);
	const oct = await admin.ok('GET', '/admin/accounts/balances', undefined, { on: '2026-10-31' });
	check(balanceOf(chart, oct, 'composition_tax_payable') === 0, 'Paid on 15 October: nothing owed');
	await admin.ok('POST', '/admin/accounts/gst-filings', {
		gstRegistrationId: ctx.registrationId,
		returnType: 'CMP-08',
		month: '2026-09',
		arn: 'AA1910260054321',
		filedOn: '2026-10-15',
		acknowledgement: null,
	});
	await lateSaleRefused(admin, check);
	const year = await prepareReturn(admin, 'GSTR-4', '2027-03');
	check(
		year.problems.some((p) => p.problem === 'gstr4_quarters_missing' && p.document === '3'),
		'GSTR-4 for 2026-27 waits for three more quarters of CMP-08',
		JSON.stringify(year.problems),
	);
	check(
		tableOf(year, 'gstr4_4a')?.taxable === 60000 && tableOf(year, 'gstr4_5')?.tax === 93.6,
		'GSTR-4: ₹60,000 bought from a registered supplier; ₹93.60 paid with CMP-08',
		JSON.stringify(year.summary),
	);
	return 'composition returns checked';
}

/** ISD (G7, AD8): a Maharashtra ISD shares a rent bill's credit with the GSTINs that had turnover, IGST to West Bengal. */
const ISD_SCENARIO = {
	name: 'ISD: a Maharashtra branch and an ISD from November; the ISD’s rent credit goes to West Bengal as IGST',
	async run({ admin, check }) {
		const terms = (kind) => ({ from: '2026-11-01', kind, scheme: 'monthly', lastYearTurnoverINR: 0 });
		const branch = await admin.ok('POST', '/admin/company/registrations', {
			gstin: gstin('27', PAN),
			legalName: 'KR Marketing Test',
			tradeName: 'Saha Textile Test',
			terms: terms('regular'),
			active: true,
		});
		const isdGstin = gstin('27', PAN, '2');
		const isd = await admin.ok('POST', '/admin/company/registrations', {
			gstin: isdGstin,
			legalName: 'KR Marketing Test',
			tradeName: 'Saha Textile Test',
			terms: terms('isd'),
			active: true,
		});
		const place = (name, shortCode, registrationId) =>
			admin.ok('POST', '/admin/locations', {
				courierPickup: false,
				showOnStoresPage: false,
				storeLocationId: null,
				stateCode: '27',
				phone: '',
				openingHours: '',
				shopsEstablishmentNo: '',
				gstRegistrationId: registrationId,
				invoiceIdentity: 'company',
				numberSeries: 'gstin',
				pettyCashFloatINR: 0,
				active: true,
				expectedUpdatedAt: null,
				name,
				shortCode,
				warehouse: false,
				store: false,
				office: true,
				shipsOnline: false,
				address: '14 Nariman Point',
				pin: '400021',
				city: 'Mumbai',
				counterCashBox: false,
			});
		await place('Mumbai branch', 'MUM', branch.id);
		await place('Mumbai office (ISD)', 'ISD', isd.id);
		// GSTR-6A for November: the office rent, ₹10,000 + CGST ₹900 + SGST ₹900 from a Mumbai landlord.
		const sixA = {
			gstin: isdGstin,
			fp: '112026',
			b2b: [
				{
					ctin: gstin('27', 'AAACM1234B'),
					inv: [
						{
							inum: 'RENT-1126',
							idt: '05-11-2026',
							val: 11800,
							itms: [
								{ num: 1, itm_det: { txval: 10000, rt: 18, iamt: 0, camt: 900, samt: 900, csamt: 0 } },
							],
						},
					],
				},
			],
			cdn: [],
		};
		const none = await admin.try('POST', '/admin/accounts/gst/returns', {
			gstRegistrationId: isd.id,
			returnType: 'GSTR-6',
			month: '2026-11',
			adjustments: [],
		});
		check(none.code === 'gstr6a_needed', 'GSTR-6 asks for its GSTR-6A first', none.code);
		let six = await prepareReturn(admin, 'GSTR-6', '2026-11', { gstRegistrationId: isd.id, inward6a: sixA });
		check(
			tableOf(six, 'gstr6_3')?.taxable === 10000 && tableOf(six, 'gstr6_3')?.tax === 1800,
			'GSTR-6 table 3: ₹10,000 of rent, ₹1,800 credit received',
			JSON.stringify(six.summary),
		);
		// Only West Bengal had turnover in July–September (the Mumbai branch starts in November): all of it there,
		// and from Maharashtra to West Bengal the CGST and SGST go as IGST.
		const share = six.isdShares?.[0];
		check(
			six.isdShares?.length === 1 &&
				share?.gstin === GSTIN &&
				share.credit.igst === 180_000 &&
				share.from.cgst === 90_000,
			'The credit goes to West Bengal: IGST ₹1,800 from the ISD’s CGST ₹900 and SGST ₹900',
			JSON.stringify(six.isdShares),
		);
		six = await approveReturn(admin, six);
		six = await admin.ok('POST', `/admin/accounts/gst/returns/${six.id}/distribute`, { version: six.version });
		check(!!six.distributionVoucherId, 'The distribution is posted once');
		const again = await admin.try('POST', `/admin/accounts/gst/returns/${six.id}/distribute`, {
			version: six.version,
		});
		check(again.status === 400, 'Posting the distribution twice is refused', again.code);
		const voucher = await admin.ok('GET', `/admin/accounts/vouchers/${six.distributionVoucherId}`);
		const debit = (voucher.lines ?? []).reduce((sum, l) => sum + l.debitPaise, 0);
		const credit = (voucher.lines ?? []).reduce((sum, l) => sum + l.creditPaise, 0);
		check(
			debit === 180_000 && credit === 180_000,
			'The distribution journal balances at ₹1,800',
			`${debit}/${credit}`,
		);
		return `ISD ${isdGstin}`;
	},
};

export const scenarios = [
	{
		name: `Company: a ${KIND.replace(/_/g, ' ')} in West Bengal, books from 1 April 2026`,
		async run({ admin }) {
			const current = await admin.ok('GET', '/admin/company');
			const partner = (id, name, pan, capitalINR, profitSharePercent, dpin) => ({
				id,
				name,
				pan,
				working: true,
				capitalINR,
				profitSharePercent,
				interestOnCapitalPercent: 12,
				monthlyRemunerationINR: 0,
				designated: KIND === 'llp',
				dpin: KIND === 'llp' ? dpin : null,
			});
			await admin.ok('PUT', '/admin/company', {
				profile: {
					kind: KIND,
					legalName: 'KR Marketing Test',
					tradeName: 'Saha Textile Test',
					pan: PAN,
					tan: null,
					cin: COMPANY ? (COMPOSITION ? 'U52100WB2026OPC123456' : 'U52100WB2026PTC123456') : null,
					llpin: KIND === 'llp' ? 'AAA-1234' : null,
					udyam: null,
					financialYearStartMonth: 4,
					booksStartOn: '2026-04-01',
					homeCurrency: 'INR',
					proprietor:
						KIND === 'proprietorship' ? { name: 'Test Proprietor', pan: PAN, openingCapitalINR: 0 } : null,
					otherBusinesses: [],
					partners: PARTNERS
						? [
								partner('ptn_a', 'Arindam Test', 'ABCPA1234K', 300_000, 60, '01234567'),
								partner('ptn_b', 'Rupa Test', 'ABCPR1234K', 200_000, 40, '07654321'),
							]
						: [],
					partnersCapital: 'fixed_with_current',
					directors: COMPANY
						? [
								{
									id: 'dir_a',
									name: 'Arindam Test',
									din: '01234567',
									since: '2026-04-01',
									paidAs: 'none',
								},
								...(COMPOSITION
									? []
									: [
											{
												id: 'dir_b',
												name: 'Rupa Test',
												din: '07654321',
												since: '2026-04-01',
												paidAs: 'none',
											},
										]),
							]
						: [],
					shareholders: COMPANY
						? COMPOSITION
							? [{ id: 'sh_a', name: 'Arindam Test', shares: 50_000 }]
							: [
									{ id: 'sh_a', name: 'Arindam Test', shares: 30_000 },
									{ id: 'sh_b', name: 'Rupa Test', shares: 20_000 },
								]
						: [],
					authorisedCapitalINR: COMPANY ? 10_00_000 : 0,
					paidUpCapitalINR: COMPANY ? 5_00_000 : 0,
					faceValueINR: 10,
					nomineeName: COMPOSITION ? 'Rupa Test' : null,
					revision: current?.profile?.revision ?? 0,
				},
				expectedUpdatedAt: current?.profile?.updatedAt ?? null,
			});
			const registration = await admin.ok('POST', '/admin/company/registrations', {
				gstin: GSTIN,
				legalName: 'KR Marketing Test',
				tradeName: 'Saha Textile Test',
				terms: {
					from: '2026-04-01',
					kind: COMPOSITION ? 'composition' : 'regular',
					scheme: QRMP ? 'qrmp' : 'monthly',
					compositionRatePercent: COMPOSITION ? 1 : null,
					lastYearTurnoverINR: COMPOSITION ? 1_00_00_000 : 4_00_00_000,
				},
				active: true,
			});
			ctx.registrationId = registration.id;
			return `GSTIN ${GSTIN} (${COMPOSITION ? 'composition' : QRMP ? 'quarterly, QRMP' : 'monthly'})`;
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
		name: `Set up the books from the ${KIND.replace(/_/g, ' ')} templates`,
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
				'profit_and_loss',
				...(KIND === 'proprietorship' ? ['capital', 'drawings'] : []),
				...(COMPANY ? ['share_capital', 'general_reserve', 'provision_for_income_tax'] : []),
				...(PARTNERS ? ['drawings', 'interest_on_partners_capital', 'partners_remuneration'] : []),
			])
				check(
					keys.has(k) || chart.ledgers.some((l) => (l.roles ?? []).includes(k)),
					`The chart has the ${k} ledger`,
				);
			if (PARTNERS) {
				const capital = KIND === 'llp' ? 'contribution' : 'capital';
				for (const name of ['Arindam Test', 'Rupa Test']) {
					check(
						chart.ledgers.some((l) => l.name === `${name} ${capital}`),
						`${name} has a ${capital} ledger`,
					);
					check(
						chart.ledgers.some((l) => l.name === `${name} current account`),
						`${name} has a current account`,
					);
				}
			}
			const opens = await admin.ok('GET', '/admin/accounts/templates/opens', undefined, { kind: KIND });
			ctx.opens = opens;
			const reports = (opens.reports ?? []).map((r) => r.code);
			const wanted = {
				proprietorship: ['RP-NCE-PL', 'RP-NCE-BS-PROP'],
				partnership: ['RP-NCE-PL', 'RP-NCE-BS-FIRM', 'RP-APPROP'],
				llp: ['RP-LLP-PL', 'RP-LLP-BS', 'RP-APPROP'],
				private_limited: ['RP-SCH3-PL', 'RP-SCH3-BS'],
				private_limited_opc: ['RP-SCH3-PL', 'RP-SCH3-BS'],
			}[KIND];
			check(
				wanted.every((code) => reports.includes(code)),
				`The ${KIND.replace(/_/g, ' ')}'s own statements open: ${wanted.join(', ')}`,
				reports.join(', '),
			);
			check(
				!reports.some((code) =>
					({
						proprietorship: /SCH3|LLP|FIRM|APPROP/,
						partnership: /SCH3|LLP-/,
						llp: /SCH3|NCE/,
						private_limited: /NCE|LLP|APPROP|FIRM/,
						private_limited_opc: /NCE|LLP|APPROP|FIRM/,
					})[KIND].test(code),
				),
				'Other kinds’ statements stay locked',
				reports.join(', '),
			);
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
			// The owners' ₹5,00,000: the proprietor's capital, the partners' capital or contribution (3:2), or share capital.
			const owners = PARTNERS
				? [
						[
							ctx.chart.ledgers.find(
								(l) => l.name === `Arindam Test ${KIND === 'llp' ? 'contribution' : 'capital'}`,
							),
							300_000,
						],
						[
							ctx.chart.ledgers.find(
								(l) => l.name === `Rupa Test ${KIND === 'llp' ? 'contribution' : 'capital'}`,
							),
							200_000,
						],
					]
				: [[ctx.chart.ledgers.find((l) => l.systemKey === (COMPANY ? 'share_capital' : 'capital')), 500_000]];
			const capital = owners[0][0];
			// Opening, as at 31 March 2026: cash ₹20,000 and bank ₹4,80,000 against the owners' ₹5,00,000.
			const csv = [
				'Ledger,Group,Debit,Credit',
				`${cash.name},Cash-in-Hand,20000,`,
				`"${bankLedger.name}",Bank Accounts,480000,`,
				...owners.map(([ledger, amount]) => `"${ledger.name}",Capital Account,,${amount}`),
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
				text: csv.replace('480000', '479000'),
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
				(balances[capital.id] ?? 0) === -owners[0][1] * 100,
				`${capital.name} opens at ₹${owners[0][1].toLocaleString('en-IN')} Cr`,
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
				balanceOf(chart, aug, 'input_cgst') === F.inputHalf,
				COMPOSITION ? 'No input CGST under composition' : 'Input CGST ₹1,500',
				String(balanceOf(chart, aug, 'input_cgst')),
			);
			check(
				balanceOf(chart, aug, 'input_sgst') === F.inputHalf,
				COMPOSITION ? 'No input SGST under composition' : 'Input SGST ₹1,500',
				String(balanceOf(chart, aug, 'input_sgst')),
			);
			check(
				balanceOf(chart, aug, 'input_igst') === 0,
				'No IGST on an intra-state bill',
				String(balanceOf(chart, aug, 'input_igst')),
			);
			check(
				balanceOf(chart, aug, 'stock_in_hand') === F.stockAug,
				COMPOSITION ? 'Stock in hand ₹63,000: the GST stays in its cost' : 'Stock in hand up ₹60,000 at cost',
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
			// Tax included at 5%: taxable 9,360 ÷ 1.05 = ₹8,914.29, tax ₹445.71 split into CGST and SGST. Under
			// composition a bill of supply: the whole ₹9,360, no tax.
			check(invoice.billOfSupply === COMPOSITION, COMPOSITION ? 'A bill of supply' : 'A tax invoice');
			check(invoice.taxableINR === F.sale1Taxable, `Taxable ₹${F.sale1Taxable}`, String(invoice.taxableINR));
			check(
				Math.round((invoice.cgstINR + invoice.sgstINR) * 100) === F.sale1Tax,
				COMPOSITION ? 'No tax charged' : 'CGST + SGST ₹445.71',
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
				balanceOf(chart, sep, 'sales') === F.salesSep,
				`Sales ₹${-F.salesSep / 100} Cr in September`,
				String(balanceOf(chart, sep, 'sales')),
			);
			check(
				balanceOf(chart, sep, 'output_cgst') + balanceOf(chart, sep, 'output_sgst') === F.outputSep,
				`Output GST ₹${-F.outputSep / 100} Cr`,
			);
			check(
				balanceOf(chart, sep, 'cost_of_goods_sold') === F.cogsSep,
				`Cost of goods sold ₹${F.cogsSep / 100} (2 sarees)`,
				String(balanceOf(chart, sep, 'cost_of_goods_sold')),
			);
			check(
				balanceOf(chart, sep, 'stock_in_hand') === F.stockSep,
				`Stock in hand ₹${F.stockSep / 100} (18 left)`,
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
			if (COMPOSITION) {
				// G2: a composition seller can't sell outside West Bengal; the order is refused before anything is kept.
				const refused = await admin.try('POST', '/admin/orders', {
					cart: {
						buyer: { kind: 'person', customerId: customer.id },
						currency: 'INR',
						lines: [{ productId: 'prd_1001', variationId: null, quantity: 1, addons: [] }],
					},
					delivery: { kind: 'saved', savedAddressId: customer.addressId },
					billing: null,
					indianInvoiceAddress: null,
					couponCodes: [],
					comment: null,
					payment: {
						method: 'manual',
						payment: {
							note: null,
							proofMediaId: null,
							collector: null,
							collectedBy: null,
							received: true,
							method: 'bankTransfer',
							amountINR: 4680,
							reference: 'UTR20261002',
							receivedOn: '2026-10-02',
						},
					},
					idempotencyKey: key('o'),
				});
				check(
					refused.status === 409 && JSON.stringify(refused.body).includes('delivery_outside_state'),
					'Under composition, an order to Mumbai is refused (no sales outside the State)',
					`${refused.status} ${JSON.stringify(refused.body).slice(0, 160)}`,
				);
				return 'refused under composition';
			}
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
			check(sale3.invoice.number === F.sale3Number, `Sale 3 invoiced as ${F.sale3Number}`, sale3.invoice.number);
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
			check(note.taxableINR === F.noteTaxable, `Credit note taxable ₹${F.noteTaxable}`, String(note.taxableINR));
			check(
				Math.round((note.cgstINR + note.sgstINR) * 100) === F.noteTax,
				`Credit note CGST + SGST ₹${F.noteTax / 100}`,
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
				balanceOf(chart, now, 'sales') === F.salesNow,
				`Sales ₹${-F.salesNow / 100} Cr`,
				String(balanceOf(chart, now, 'sales')),
			);
			check(
				balanceOf(chart, now, 'sales_returns') === F.returnsNow,
				`Sales returns ₹${F.returnsNow / 100} Dr`,
				String(balanceOf(chart, now, 'sales_returns')),
			);
			check(
				balanceOf(chart, now, 'output_cgst') + balanceOf(chart, now, 'output_sgst') === F.outputNow,
				'Output CGST + SGST: sale 3 and its return cancel',
				String(balanceOf(chart, now, 'output_cgst') + balanceOf(chart, now, 'output_sgst')),
			);
			check(
				balanceOf(chart, now, 'cost_of_goods_sold') === F.cogsNow,
				`Cost of goods sold ₹${F.cogsNow / 100}`,
				String(balanceOf(chart, now, 'cost_of_goods_sold')),
			);
			check(
				balanceOf(chart, now, 'stock_in_hand') === F.stockNow,
				`Stock in hand ₹${F.stockNow / 100}`,
				String(balanceOf(chart, now, 'stock_in_hand')),
			);
			check(
				balanceOf(chart, now, 'upi_card_clearing') === 1_404_000,
				'UPI clearing ₹14,040 (sales 1 and 3)',
				String(balanceOf(chart, now, 'upi_card_clearing')),
			);
			check(
				(now[ctx.bankLedgerId] ?? 0) === F.bankNow,
				`HDFC ₹${F.bankNow / 100} after the ₹4,680 refund`,
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
		name: COMPOSITION
			? 'GST under composition: CMP-08 for July–September, booked, paid and filed; September locked; GSTR-4 waits'
			: QRMP
				? 'GST quarterly (QRMP): GSTR-1 for the quarter, IFF and PMT-06 in October, filed; September locked; GSTR-3B'
				: 'GST returns: GSTR-1 September and October against the invoices, filed; September then locked; GSTR-3B',
		async run({ admin, check }) {
			if (QRMP) return qrmpGst(admin, check);
			if (COMPOSITION) return compositionGst(admin, check);
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
	...(QRMP ? [ISD_SCENARIO] : []),
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
			// Composition: sales ₹9,360 net of the return, cost ₹6,300, CMP-08 tax ₹93.60: profit ₹2,966.40.
			const profit = COMPOSITION ? 296_640 : 437_143;
			check(
				plText.includes(String(profit)) || plText.includes((profit / 100).toFixed(2)),
				`Profit for the year ₹${(profit / 100).toFixed(2)}`,
				plText.slice(0, 300),
			);
			const bs = await admin.ok('GET', '/admin/accounts/reports/statements/balanceSheet', undefined, {
				asAt: today,
			});
			check(bs.problems?.length === 0, 'The balance sheet layout has no problems', JSON.stringify(bs.problems));
			// Assets: cash 20,000 + HDFC 4,17,000 + UPI clearing 18,720 (sales 1 and 3, and the refused late sale's
			// ₹4,680 still held as the customer's advance) + stock 51,000 = ₹5,06,720. Funds and liabilities: capital
			// 5,00,000 + profit 4,371.43 + advance 4,680 − GST 2,331.43 (input 3,000 net of output 668.57) = ₹5,06,720.
			// Composition: cash 20,000 + HDFC 4,12,226.40 (no Mumbai receipt; CMP-08 ₹93.60 paid) + UPI 18,720 + stock
			// 56,700 (18 at ₹3,150) = ₹5,07,646.40 = capital 5,00,000 + profit 2,966.40 + advance 4,680. The partnership's
			// PMT-06 deposit and the ISD's credit only move money between assets.
			const totalPaise = COMPOSITION ? 50_764_640 : 50_672_000;
			check(
				bs.rows.filter((r) => r.depth === 0).length === 2 &&
					bs.rows.filter((r) => r.depth === 0).every((r) => r.thisYearPaise === totalPaise),
				`Both sides of the ${KIND.replace(/_/g, ' ')}'s balance sheet ₹${(totalPaise / 100).toFixed(2)}`,
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
	{
		name: 'Counter: the store opens its day sheet and sells 1 saree for cash',
		async run({ admin, check }) {
			// Settings › Cash boxes: the store's counter box, a day sheet with no float.
			const settings = await admin.ok('GET', '/admin/cash/settings');
			await admin.ok('PUT', '/admin/cash/settings', {
				boxes: [
					{
						name: 'Gariahat counter',
						locationId: ctx.storeId,
						kind: 'day_sheet',
						floatPaise: 0,
						countedBy: 'cashier',
						reviewedBy: 'owner',
						active: true,
					},
				],
				denominations: settings.settings.denominations,
				rules: settings.settings.rules,
			});
			const today = await admin.ok('GET', '/admin/cash/today');
			const rows = today.denominations
				.filter((d) => d.on)
				.map((d) => ({ valuePaise: d.valuePaise, kind: d.kind, count: 0 }));
			await admin.ok('POST', '/admin/cash/sheets', {
				boxId: today.box.id,
				count: { rows },
				carryDifference: false,
			});
			const lines = [{ productId: 'prd_1001', variationId: null, quantity: 1, scanned: true }];
			const quote = await admin.ok('POST', '/admin/counter/quote', { locationId: ctx.storeId, lines });
			const total = quote.totalINR ?? quote.totals?.totalINR;
			check(total === 4680, 'The counter quotes ₹4,680', String(total));
			const before = await admin.ok('GET', '/admin/accounts/balances', undefined, {
				on: new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10),
			});
			const sale = await admin.ok('POST', '/admin/counter/sales', {
				locationId: ctx.storeId,
				lines,
				buyer: { phone: '', name: 'Walk-in', address: '', gstin: '' },
				payments: [{ method: 'cash', amountINR: total, reference: '' }],
				cashHandedINR: 5000,
				print: 'roll80',
				expectedTotalINR: total,
			});
			const invoice = sale.invoice ?? sale;
			check(
				// The next number after the shop's sales: no Mumbai sale under composition, so one earlier.
				(COMPOSITION ? /TI\/26-27\/00000[3-9]/ : /TI\/26-27\/00000[4-9]/).test(
					invoice.number ?? invoice.invoiceNumber ?? '',
				),
				'The counter sale is invoiced in the same series',
				invoice.number ?? invoice.invoiceNumber,
			);
			const after = await admin.ok('GET', '/admin/accounts/balances', undefined, {
				on: new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10),
			});
			const moved = (k) => balanceOf(ctx.chart, after, k) - balanceOf(ctx.chart, before, k);
			// A bill of supply under composition: the whole ₹4,680 is the sale.
			const counterSales = COMPOSITION ? -468_000 : -445_714;
			check(
				moved('sales') === counterSales,
				`Counter sale: sales ₹${-counterSales / 100} Cr`,
				String(moved('sales')),
			);
			check(
				moved('cost_of_goods_sold') === F.unitCost,
				'Counter sale: cost ₹3,000',
				String(moved('cost_of_goods_sold')),
			);
			check(sumBalances(after) === 0, 'The trial balance balances after the counter sale');
			return `${invoice.number ?? invoice.invoiceNumber} ₹${total}, change ₹${5000 - total}`;
		},
	},
	{
		name: 'Fixed asset: a billing computer bought from HDFC on 1 Nov (₹60,000, 6 years SLM); November depreciation posted',
		async run({ admin, check }) {
			const asset = await admin.ok('POST', '/admin/accounts/assets', {
				name: 'Billing computer',
				categoryKey: 'computers',
				locationId: ctx.storeId,
				putToUseOn: '2026-11-01',
				costINR: 60_000,
				residualINR: 3_000,
				method: 'slm',
				lifeMonths: 72,
				taxRatePct: 40,
				run: 'monthly',
				inputGst: 'claimed',
				reference: 'INV-PC-1',
				acquisition: { kind: 'post', ledgerId: ctx.bankLedgerId },
			});
			check(asset.tag === 'FA-0001', 'Tagged FA-0001', asset.tag);
			const run = await admin.ok('POST', '/admin/accounts/assets/depreciation/2026-11');
			// SLM: (60,000 − 3,000) ÷ 72 = ₹791.67 a month.
			check(run.totalPaise === 79_167, 'November depreciation ₹791.67', String(run.totalPaise));
			const again = await admin.try('POST', '/admin/accounts/assets/depreciation/2026-11');
			check(again.code === 'depreciation_posted', 'A month is depreciated once', again.code);
			return asset.tag;
		},
	},
	{
		name: 'Year close 2026-27: the checks, the closing entries, and the year read as it was',
		async run({ admin, check }) {
			const view = await admin.ok('GET', '/admin/accounts/year-close/2026-27');
			check(view.checks.length === 10, 'Ten checks', String(view.checks.length));
			const by = Object.fromEntries(view.checks.map((c) => [c.key, c]));
			// Monthly: GSTR-1 and 3B × 12. QRMP: 4 quarters × 2, the Mumbai branch 5 months × 2 and the ISD's GSTR-6
			// × 5 from November. Composition: CMP-08 × 4. One filed so far in each.
			const due = COMPOSITION ? 4 : QRMP ? 23 : 24;
			check(
				by.gst.state === 'attention' && by.gst.count === 1 && by.gst.of === due,
				`GST: 1 of ${due} returns filed so far`,
				`${by.gst.count} of ${by.gst.of}`,
			);
			check(by.depreciation.state === 'attention', 'Depreciation to March still due on the computer');
			check(by.closing.state === 'attention', 'No closing entries yet');
			check(!view.canClose, 'The year cannot be closed yet');
			await admin.ok('POST', '/admin/accounts/year-close/2026-27/confirm', { accruals: true });
			const plBefore = await admin.ok('GET', '/admin/accounts/reports/statements/profitLoss', undefined, {
				asAt: '2027-03-31',
			});
			check(
				!(await admin.ok('GET', '/admin/accounts/year-close/2026-27')).canPostClosing,
				'Closing entries wait while checks are open',
			);
			return `${view.done} of ${view.checks.length} done; profit row ${plBefore.rows.at(-1)?.thisYearPaise}`;
		},
	},
];

export const helpers = { balanceOf, rupees };
