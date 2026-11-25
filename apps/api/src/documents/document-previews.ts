import { renderSVG } from 'uqr';
import type { DocumentKind } from '@saha-textile/contracts';

import { payslipData } from './payslip-print';
import type { DocumentData, DocumentRow } from './document-data';

/**
 * What the format builder and the eye button preview with (bundle builder brief F05): one worked example per
 * document, in the shape a real one prints. The tax invoice is the brief's own example — a set with a free item on a
 * piece and an extra, then a saree with two free items. HSN codes, rates and the GSTIN are examples until the CA
 * settles them (DEC-TAX-HSN).
 */

const SELLER = {
	name: 'Saha Textile',
	lines: [
		'No. 29, KB Basu Road, Champadali, Haritala, Barasat, Kolkata 700124, West Bengal',
		'GSTIN 19ABCDE1234F1Z5 · State West Bengal (19)',
		'+91 98366 63137 · wecare@sahatextile.com',
	],
};
const BUYER = ['Ananya Iyer', 'B-702 Sea Breeze, Bandra West', 'Mumbai 400050, Maharashtra (27)', '+91 98200 55441'];
const SUPPLIER = ['Bishnupur Weavers Co-operative', 'Station Road, Bishnupur, Bankura 722122', 'GSTIN 19AAAAB1234C1Z2'];
const TODAY = '22 Nov 2026';

const line = (over: Partial<DocumentRow> & { cells: Record<string, string> }): DocumentRow => ({
	kind: 'line',
	depth: 0,
	...over,
});

const INVOICE_ROWS: DocumentRow[] = [
	line({
		kind: 'set',
		cells: { index: '1', item: 'Wedding saree set' },
		sku: 'BND-0003',
		sub: 'pieces added up, 10% off: set price ₹16,425 + extra ₹250',
	}),
	line({
		kind: 'piece',
		depth: 1,
		cells: {
			item: '1. Bottle Green Phekwa Buti Wedding Banarasi Saree',
			hsn: '5007',
			qty: '1 pc',
			rate: '₹14,760.00',
			taxable: '₹14,057.14',
			gstRate: '5%',
			tax: '₹702.86',
			amount: '₹14,760.00',
		},
		sku: 'ST-1082',
		sub: 'share of set',
	}),
	line({
		kind: 'free',
		depth: 2,
		cells: {
			item: 'Cotton petticoat · black',
			hsn: '6208',
			qty: '1 pc',
			rate: '₹0.00',
			taxable: '₹0.00',
			gstRate: '5%',
			tax: '₹0.00',
			amount: '₹0.00',
		},
		sku: 'ST-PET-002',
		sub: 'free with piece 1',
		struck: '₹799.00',
	}),
	line({
		kind: 'piece',
		depth: 1,
		cells: {
			item: '2. Silk blouse piece',
			hsn: '5007',
			qty: '1 pc',
			rate: '₹1,080.00',
			taxable: '₹1,028.57',
			gstRate: '5%',
			tax: '₹51.43',
			amount: '₹1,080.00',
		},
		sku: 'ST-BLP-001',
		sub: 'share of set',
	}),
	line({
		kind: 'piece',
		depth: 1,
		cells: {
			item: '3. Cotton petticoat · cream',
			hsn: '6208',
			qty: '1 pc',
			rate: '₹585.00',
			taxable: '₹557.14',
			gstRate: '5%',
			tax: '₹27.86',
			amount: '₹585.00',
		},
		sku: 'ST-PET-001',
		sub: 'share of set',
	}),
	line({
		kind: 'extra',
		depth: 1,
		cells: {
			item: 'Gift box',
			hsn: '4819',
			qty: '1 pc',
			rate: '₹250.00',
			taxable: '₹211.86',
			gstRate: '18%',
			tax: '₹38.14',
			amount: '₹250.00',
		},
		sku: 'ST-BOX-001',
	}),
	line({
		cells: {
			index: '2',
			item: 'Peacock Blue Korvai Border Kanchipuram Saree',
			hsn: '5007',
			qty: '1 pc',
			rate: '₹35,800.00',
			taxable: '₹34,095.24',
			gstRate: '5%',
			tax: '₹1,704.76',
			amount: '₹35,800.00',
		},
		sku: 'ST-933',
	}),
	line({
		kind: 'free',
		depth: 1,
		cells: {
			item: 'Cotton petticoat · cream',
			hsn: '6208',
			qty: '1 pc',
			rate: '₹0.00',
			taxable: '₹0.00',
			gstRate: '5%',
			tax: '₹0.00',
			amount: '₹0.00',
		},
		sku: 'ST-PET-001',
		sub: 'free with the Peacock Blue saree',
		struck: '₹799.00',
	}),
	line({
		kind: 'free',
		depth: 1,
		cells: {
			item: 'Saree cover bag',
			hsn: '4202',
			qty: '1 pc',
			rate: '₹0.00',
			taxable: '₹0.00',
			gstRate: '5%',
			tax: '₹0.00',
			amount: '₹0.00',
		},
		sku: 'ST-BAG-001',
		sub: 'free with the Peacock Blue saree',
		struck: '₹350.00',
	}),
];

const simpleRows = (rows: Array<Record<string, string>>): DocumentRow[] =>
	rows.map((cells, at) => line({ cells: { index: String(at + 1), ...cells } }));

const EXAMPLE_IRN = '16249c4dea9e9ad1f40245b8d7cf6f48e0a6233a694ee112d578da7e22e24e34';
const exampleB64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const EXAMPLE_SIGNED_QR = [
	exampleB64({ alg: 'RS256', typ: 'JWT', kid: 'EXAMPLE' }),
	exampleB64({ data: JSON.stringify({ DocNo: 'TI/26-27/000125', DocTyp: 'INV', Irn: EXAMPLE_IRN, Example: true }) }),
	'example',
].join('.');

export function previewDocument(doc: DocumentKind): DocumentData {
	const base = { doc, date: TODAY, seller: SELLER, values: {}, parties: {} } as const;
	switch (doc) {
		case 'taxInvoice':
			return {
				...base,
				title: 'Tax invoice',
				number: 'TI/26-27/000125',
				// The e-invoice band's example QR (addendum 2, EI8): drawn from an example, unsigned payload.
				qrSvg: renderSVG(EXAMPLE_SIGNED_QR, { ecc: 'M', border: 1 }),
				values: {
					copyLabel: 'Original for recipient',
					invoiceNo: 'TI/26-27/000125',
					invoiceDate: TODAY,
					orderNo: 'ST-2611-482207',
					orderDate: TODAY,
					placeOfSupply: 'Maharashtra (27)',
					reverseCharge: 'No',
					irn: EXAMPLE_IRN,
					ackNo: '112410123456789',
					ackDate: TODAY,
					ewayBill: '3410 1234 5678',
					payment: 'Paid in full · card via CCAvenue · ref 3104 2211 9012',
					amountInWords: 'Rupees Fifty Two Thousand Four Hundred Seventy Five Only',
				},
				parties: {
					billTo: { heading: 'Billed to', lines: BUYER },
					shipTo: { heading: 'Shipped to', lines: BUYER },
				},
				taxHeading: 'IGST',
				rows: INVOICE_ROWS,
				hsnSummary: [
					{ hsn: '5007', taxable: '₹49,180.95', rate: '5%', tax: '₹2,459.05' },
					{ hsn: '6208', taxable: '₹557.14', rate: '5%', tax: '₹27.86' },
					{ hsn: '4819', taxable: '₹211.86', rate: '18%', tax: '₹38.14' },
					{ hsn: '4202', taxable: '₹0.00', rate: '5%', tax: '₹0.00' },
				],
				totals: {
					totals: [
						{ label: 'Taxable value', value: '₹49,949.95' },
						{ label: 'IGST', value: '₹2,525.05' },
						{ label: 'Total', value: '₹52,475.00' },
					],
					roundOff: [{ label: 'Round off', value: '₹0.00' }],
				},
				signatures: {
					declaration:
						'We declare that this document shows the actual price of the goods described and that all particulars are true and correct.',
				},
			};
		case 'creditNote':
			return {
				...base,
				title: 'Credit note',
				number: 'CN/26-27/000004',
				values: {
					noteNo: 'CN/26-27/000004',
					noteDate: TODAY,
					originalInvoiceNo: 'TI/26-27/000125',
					originalInvoiceDate: '18 Nov 2026',
					placeOfSupply: 'Maharashtra (27)',
					reason: 'One piece of the set returned unused (return ST-2611-482207/R1).',
					refundTo: 'The card it was paid with · within 7 working days',
					amountInWords: 'Rupees One Thousand Eighty Only',
				},
				parties: { billTo: { heading: 'Billed to', lines: BUYER } },
				taxHeading: 'IGST',
				rows: [
					line({
						kind: 'set',
						cells: { index: '1', item: 'Wedding saree set' },
						sku: 'BND-0003',
						sub: 'the set stays; one piece returned',
					}),
					INVOICE_ROWS[3]!,
				],
				hsnSummary: [{ hsn: '5007', taxable: '₹1,028.57', rate: '5%', tax: '₹51.43' }],
				totals: {
					totals: [
						{ label: 'Taxable value', value: '₹1,028.57' },
						{ label: 'IGST', value: '₹51.43' },
						{ label: 'Credited', value: '₹1,080.00' },
					],
				},
			};
		case 'debitNote':
			return {
				...base,
				title: 'Debit note',
				number: 'DN/26-27/000002',
				values: {
					noteNo: 'DN/26-27/000002',
					noteDate: TODAY,
					originalInvoiceNo: 'BW/1182',
					reason: 'Two sarees sent back: weaving fault.',
				},
				parties: { party: { heading: 'To', lines: SUPPLIER } },
				taxHeading: 'CGST + SGST',
				rows: simpleRows([
					{
						item: 'Baluchari Silk Saree · maroon',
						hsn: '5007',
						qty: '2 pc',
						rate: '₹6,200.00',
						taxable: '₹12,400.00',
						gstRate: '5%',
						tax: '₹620.00',
						amount: '₹13,020.00',
					},
				]),
				totals: {
					totals: [
						{ label: 'Taxable value', value: '₹12,400.00' },
						{ label: 'CGST + SGST', value: '₹620.00' },
						{ label: 'Total', value: '₹13,020.00' },
					],
				},
			};
		case 'receipt':
			return {
				...base,
				title: 'Receipt voucher',
				number: 'RC/26-27/000011',
				values: {
					receiptNo: 'RC/26-27/000011',
					date: TODAY,
					orderNo: 'ST-2611-300718',
					placeOfSupply: 'West Bengal (19)',
					amount: '₹10,000.00',
					method: 'UPI',
					reference: 'UPI 4410 2231 0098',
					taxOnAdvance: 'None: an advance for goods carries no GST',
					amountInWords: 'Rupees Ten Thousand Only',
				},
				parties: { payer: { heading: 'Received from', lines: BUYER } },
			};
		case 'refundVoucher':
			return {
				...base,
				title: 'Refund voucher',
				number: 'RF/26-27/000002',
				values: {
					voucherNo: 'RF/26-27/000002',
					date: TODAY,
					receiptNo: 'RC/26-27/000011',
					amount: '₹10,000.00',
					taxReversed: 'None',
					method: 'UPI',
					reference: 'UPI 4410 2299 1204',
					reason: 'Open order cancelled before anything was sent.',
				},
				parties: { payee: { heading: 'Paid to', lines: BUYER } },
			};
		case 'deliveryChallan':
			return {
				...base,
				title: 'Delivery challan',
				number: 'DC/26-27/000014',
				values: {
					challanNo: 'DC/26-27/000014',
					date: TODAY,
					purpose: 'Job work: blouse stitching (not a sale)',
					transport: 'By hand',
				},
				parties: {
					consignee: { heading: 'Consignee', lines: ['Rina Tailoring', '12 Jessore Road, Barasat 700124'] },
				},
				rows: simpleRows([{ item: 'Silk blouse piece', hsn: '5007', qty: '3 pc', value: '₹3,240.00' }]),
				totals: { totals: [{ label: 'Value of goods', value: '₹3,240.00' }] },
			};
		case 'packingSlip':
			return {
				...base,
				title: 'Packing slip',
				number: 'ST-2611-482190/P1',
				values: {
					parcelNo: 'ST-2611-482190/P1',
					orderNo: 'ST-2611-482190',
					date: TODAY,
					courier: 'Shiprocket · Delhivery',
					awb: '1490 2233 8821',
				},
				parties: { shipTo: { heading: 'Ship to', lines: BUYER } },
				rows: [
					line({
						cells: {
							index: '1',
							item: 'Peacock Blue Korvai Border Kanchipuram Saree',
							qty: '1',
							cameWith: 'Peacock Blue set, piece 1',
						},
						sku: 'ST-933',
					}),
					line({
						cells: {
							index: '2',
							item: 'Cotton petticoat · cream · M',
							qty: '1',
							cameWith: 'Free with piece 1',
						},
						sku: 'ST-PET-001',
					}),
					line({
						cells: {
							index: '3',
							item: 'Off White Korvai Border Arni Saree',
							qty: '1',
							cameWith: 'Peacock Blue set, piece 2',
						},
						sku: 'ST-1086',
					}),
					line({
						cells: { index: '4', item: 'Lavender Resham Bel Saree', qty: '1', cameWith: 'Its own line' },
						sku: 'ST-1096',
					}),
					line({
						cells: {
							index: '5',
							item: 'Saree cover bag',
							qty: '1',
							cameWith: 'Free with the Lavender saree',
						},
						sku: 'ST-BAG-001',
					}),
				],
				signatures: { packedBy: '' },
			};
		case 'returnNote':
			return {
				...base,
				title: 'Return note',
				number: 'ST-2611-482207/R1',
				values: {
					returnNo: 'ST-2611-482207/R1',
					orderNo: 'ST-2611-482207',
					date: TODAY,
					reason: 'Colour not as expected',
					refund: '₹1,080.00 to the card it was paid with',
				},
				parties: { customer: { heading: 'Customer', lines: BUYER } },
				rows: simpleRows([
					{
						item: 'Silk blouse piece (piece 2 of the Wedding saree set)',
						qty: '1',
						condition: 'Unused, tags on',
					},
				]),
			};
		case 'purchaseOrder':
			return {
				...base,
				title: 'Purchase order',
				number: 'PO/26-27/000052',
				values: {
					poNo: 'PO/26-27/000052',
					date: TODAY,
					expectedBy: '5 Dec 2026',
					noteToSupplier: 'Please pack each saree in its own cover.',
				},
				parties: {
					supplier: { heading: 'To', lines: SUPPLIER },
					deliverTo: { heading: 'Deliver to', lines: [SELLER.name, SELLER.lines[0]!] },
				},
				rows: simpleRows([
					{
						item: 'Baluchari Silk Saree · maroon',
						supplierCode: 'BL-22',
						qty: '6 pc',
						rate: '₹6,200.00',
						gstRate: '5%',
						amount: '₹37,200.00',
					},
					{
						item: 'Swarnachari Saree · blue',
						supplierCode: 'SW-08',
						qty: '4 pc',
						rate: '₹8,400.00',
						gstRate: '5%',
						amount: '₹33,600.00',
					},
				]),
				totals: { totals: [{ label: 'Expected total (before GST)', value: '₹70,800.00' }] },
			};
		case 'purchaseEntry':
			return {
				...base,
				title: 'Goods receipt',
				number: 'PE/26-27/000037',
				values: {
					entryNo: 'PE/26-27/000037',
					billNo: 'BW/1182',
					billDate: '20 Nov 2026',
					receivedOn: TODAY,
					poNo: 'PO/26-27/000052',
				},
				parties: { supplier: { heading: 'From', lines: SUPPLIER } },
				rows: simpleRows([
					{
						item: 'Baluchari Silk Saree · maroon',
						hsn: '5007',
						ordered: '6',
						received: '5 (1 short)',
						rate: '₹6,200.00',
						taxable: '₹31,000.00',
						gstRate: '5%',
						amount: '₹32,550.00',
					},
					{
						item: 'Swarnachari Saree · blue',
						hsn: '5007',
						ordered: '4',
						received: '4',
						rate: '₹8,400.00',
						taxable: '₹33,600.00',
						gstRate: '5%',
						amount: '₹35,280.00',
					},
				]),
				totals: {
					totals: [
						{ label: 'Taxable value', value: '₹64,600.00' },
						{ label: 'GST', value: '₹3,230.00' },
						{ label: 'Total', value: '₹67,830.00' },
					],
				},
				signatures: { receivedBy: 'Store keeper' },
			};
		case 'purchaseReturnNote':
			return {
				...base,
				title: 'Purchase return note',
				number: 'PR/26-27/000003',
				values: {
					returnNo: 'PR/26-27/000003',
					date: TODAY,
					entryNo: 'PE/26-27/000037',
					reason: 'Weaving fault',
				},
				parties: { supplier: { heading: 'To', lines: SUPPLIER } },
				rows: simpleRows([
					{ item: 'Baluchari Silk Saree · maroon', qty: '2 pc', rate: '₹6,200.00', amount: '₹12,400.00' },
				]),
				totals: { totals: [{ label: 'Total (before GST)', value: '₹12,400.00' }] },
			};
		case 'selfInvoice':
			return {
				...base,
				title: 'Self-invoice',
				number: 'SI/26-27/000006',
				values: {
					selfInvoiceNo: 'SI/26-27/000006',
					date: TODAY,
					placeOfSupply: 'West Bengal (19)',
					rcmNote: 'Tax payable on reverse charge: Yes. Bought from an unregistered supplier.',
				},
				parties: {
					supplier: {
						heading: 'Supplier (unregistered)',
						lines: ['Haripada Basak, weaver', 'Phulia, Nadia 741402'],
					},
				},
				taxHeading: 'CGST + SGST',
				rows: simpleRows([
					{
						item: 'Handloom tant saree',
						hsn: '5208',
						qty: '10 pc',
						rate: '₹950.00',
						taxable: '₹9,500.00',
						tax: '₹475.00',
					},
				]),
				totals: {
					totals: [
						{ label: 'Taxable value', value: '₹9,500.00' },
						{ label: 'CGST + SGST (reverse charge)', value: '₹475.00' },
						{ label: 'Total', value: '₹9,975.00' },
					],
				},
			};
		case 'paymentVoucher':
			return {
				...base,
				title: 'Payment voucher',
				number: 'PV/26-27/000021',
				values: {
					voucherNo: 'PV/26-27/000021',
					date: TODAY,
					against: 'SI/26-27/000006',
					amount: '₹9,500.00',
					method: 'Bank transfer',
					reference: 'NEFT 0098 1123',
					rcmTax: '₹475.00 paid by us under reverse charge',
				},
				parties: { payee: { heading: 'Paid to', lines: ['Haripada Basak, weaver', 'Phulia, Nadia 741402'] } },
			};
		case 'stockAdjustment':
			return {
				...base,
				title: 'Stock adjustment',
				number: 'SA/26-27/000008',
				values: { adjustmentNo: 'SA/26-27/000008', date: TODAY },
				rows: simpleRows([
					{
						item: 'Cotton petticoat · cream · M',
						before: '14',
						change: '−2',
						after: '12',
						reason: 'Damaged in the store',
					},
				]),
				signatures: { approvedBy: 'Owner' },
			};
		case 'stockCount':
			return {
				...base,
				title: 'Stock count sheet',
				number: 'SC/26-27/000002',
				values: { countNo: 'SC/26-27/000002', date: TODAY, area: 'Silk sarees, rack 3' },
				rows: simpleRows([
					{ item: 'Baluchari Silk Saree · maroon', expected: '9', counted: '9', difference: '0' },
					{ item: 'Swarnachari Saree · blue', expected: '6', counted: '5', difference: '−1' },
				]),
				signatures: { countedBy: 'Store keeper', checkedBy: 'Owner' },
			};
		case 'openingStock':
			return {
				...base,
				title: 'Opening stock',
				number: 'OS/26-27/000001',
				values: { openingNo: 'OS/26-27/000001', date: '1 Apr 2026' },
				rows: simpleRows([
					{
						item: 'Peacock Blue Korvai Border Kanchipuram Saree',
						qty: '3',
						cost: '₹24,000.00',
						value: '₹72,000.00',
					},
					{ item: 'Cotton petticoat · cream · M', qty: '14', cost: '₹310.00', value: '₹4,340.00' },
				]),
				totals: { totals: [{ label: 'Opening value', value: '₹76,340.00' }] },
				signatures: { preparedBy: 'Accounts' },
			};
		case 'payslip':
			// Brief 25 PS2's example: Priya Sen, November 2026.
			return payslipData({
				seller: SELLER,
				month: '2026-11',
				year: '2026-27',
				daysInMonth: 30,
				paidOn: '2026-11-30',
				rulesFrom: '2026-04-01',
				// 0.5% each of ₹8,700 PF wages: admin charges and EDLI.
				pfChargesPaise: 87_00,
				locationName: 'Barasat warehouse',
				stateName: 'West Bengal',
				employee: {
					code: 'EMP-0007',
					designation: 'Packer',
					department: 'Dispatch',
					joinedOn: '2025-06-04',
					leftOn: null,
					pan: 'ABCPS1234K',
					uan: '101234567890',
					esiNumber: '3112345678',
					bankAccount: '50100123454821',
					dateOfBirth: null,
					structure: { basic: 7_200, da: 900, hra: 3_600, conveyance: 1_600, special: 4_700, other: 0 },
				},
				earlier: [],
				row: {
					employeeId: 'emp_example',
					name: 'Priya Sen',
					locationId: 'loc_example',
					stateCode: '19',
					paidDays: 29,
					grossPaise: 1_740_000,
					pfWagesPaise: 870_000,
					pfEmployeePaise: 104_400,
					pfEmployerPaise: 104_400,
					epsPaise: 72_500,
					esiEmployeePaise: 13_100,
					esiEmployerPaise: 56_600,
					ptPaise: 13_000,
					tdsPaise: 0,
					advancePaise: 100_000,
					netPaise: 1_509_500,
					lwfEmployeePaise: 0,
					lwfEmployerPaise: 0,
					gratuityPaise: 41_800,
					headsPaise: {
						basic: 696_000,
						da: 87_000,
						hra: 348_000,
						conveyance: 154_667,
						special: 454_333,
						other: 0,
					},
					payslipNo: 'PS/26-27/000124',
					tax: {
						regime: 'new',
						yearSalaryPaise: 21_540_000,
						deductionsPaise: 7_500_000,
						taxablePaise: 14_040_000,
						yearTaxPaise: 0,
						deductedBeforePaise: 0,
						monthsLeft: 5,
					},
				},
			});
		case 'journal':
			return {
				...base,
				title: 'Journal voucher',
				number: 'JV/26-27/000012',
				values: {
					voucherNo: 'JV/26-27/000012',
					date: '30 Nov 2026',
					narration: 'Free items given with sales in November, at cost, booked as promotion.',
				},
				rows: [
					line({ cells: { account: 'Promotion expense', debit: '₹4,120.00', credit: '' } }),
					line({ cells: { account: 'Purchases (free items given)', debit: '', credit: '₹4,120.00' } }),
				],
				signatures: { preparedBy: 'Accounts', approvedBy: 'Owner' },
			};
	}
}
