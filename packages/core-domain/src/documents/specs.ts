import type { DocumentBlockSpec, DocumentBlockType, DocumentKind, DocumentSpec } from '@saha-textile/contracts';

/**
 * What each document may show (bundle builder brief F, "Fields each document may show", approved 2026-11-22): its
 * blocks, each block's fields in the order ours prints them, the fields the law needs (always on) and the blocks that
 * can't be hidden. The builder offers these and nothing else (F04); the renderer draws only these.
 */
export interface CoreBlockSpec extends DocumentBlockSpec {
	/** The fields our own format shows; the rest are offered but start off. Defaults to every field. */
	ours?: string[];
}

export interface CoreDocumentSpec extends Omit<DocumentSpec, 'blocks' | 'tree'> {
	tree?: boolean;
	blocks: CoreBlockSpec[];
}

const block = (
	type: DocumentBlockType,
	fields: string[],
	extra: { locked?: string[]; required?: boolean; ours?: string[] } = {},
): CoreBlockSpec => ({
	type,
	fields,
	lockedFields: extra.locked ?? [],
	required: extra.required ?? false,
	...(extra.ours ? { ours: extra.ours } : {}),
});

/** Text blocks the shop types itself; any document may have several. */
const text = block('text', []);
const footer = block('footer', ['pageNumber', 'formatName']);

/** The lines of a GST sale (F05's columns): the tax split is one column, CGST + SGST or IGST by place of supply. */
const SALE_COLUMNS = ['index', 'item', 'hsn', 'qty', 'rate', 'discount', 'taxable', 'gstRate', 'tax', 'amount'];
const SALE_LOCKED = ['item', 'hsn', 'qty', 'taxable', 'gstRate', 'tax', 'amount'];

export const DOCUMENT_SPECS: Record<DocumentKind, CoreDocumentSpec> = {
	taxInvoice: {
		doc: 'taxInvoice',
		group: 'sales',
		gst: true,
		tree: true,
		blocks: [
			block('brand', ['logo', 'seller'], { locked: ['seller'], required: true }),
			block('title', ['copyLabel']),
			block('facts', ['invoiceNo', 'invoiceDate', 'orderNo', 'orderDate', 'placeOfSupply', 'reverseCharge'], {
				locked: ['invoiceNo', 'invoiceDate', 'placeOfSupply', 'reverseCharge'],
				required: true,
			}),
			block('parties', ['billTo', 'shipTo', 'buyerGstin'], { locked: ['billTo', 'buyerGstin'], required: true }),
			block('einvoice', ['irn', 'ackNo', 'ackDate', 'signedQr']),
			block('eway', ['ewayBill']),
			block('table', SALE_COLUMNS, {
				locked: SALE_LOCKED,
				required: true,
				ours: SALE_COLUMNS.filter((c) => c !== 'discount'),
			}),
			block('hsnSummary', []),
			block('totals', ['totals', 'roundOff'], { locked: ['totals'], required: true }),
			block('words', ['amountInWords']),
			block('payment', ['payment']),
			text,
			block('signature', ['declaration', 'signature'], { locked: ['signature'], required: true }),
			footer,
		],
	},
	creditNote: {
		doc: 'creditNote',
		group: 'sales',
		gst: true,
		tree: true,
		blocks: [
			block('brand', ['logo', 'seller'], { locked: ['seller'], required: true }),
			block('title', []),
			block('facts', ['noteNo', 'noteDate', 'originalInvoiceNo', 'originalInvoiceDate', 'placeOfSupply'], {
				locked: ['noteNo', 'noteDate', 'originalInvoiceNo', 'placeOfSupply'],
				required: true,
			}),
			block('parties', ['billTo', 'buyerGstin'], { locked: ['billTo', 'buyerGstin'], required: true }),
			block('table', SALE_COLUMNS, {
				locked: SALE_LOCKED,
				required: true,
				ours: SALE_COLUMNS.filter((c) => c !== 'discount'),
			}),
			block('hsnSummary', []),
			block('totals', ['totals'], { locked: ['totals'], required: true }),
			block('words', ['amountInWords']),
			block('note', ['reason']),
			block('payment', ['refundTo']),
			text,
			block('signature', ['signature'], { locked: ['signature'], required: true }),
			footer,
		],
	},
	debitNote: {
		doc: 'debitNote',
		group: 'sales',
		gst: true,
		blocks: [
			block('brand', ['logo', 'seller'], { locked: ['seller'], required: true }),
			block('title', []),
			block('facts', ['noteNo', 'noteDate', 'originalInvoiceNo'], {
				locked: ['noteNo', 'noteDate'],
				required: true,
			}),
			block('parties', ['party'], { locked: ['party'], required: true }),
			block('table', ['index', 'item', 'hsn', 'qty', 'rate', 'taxable', 'gstRate', 'tax', 'amount'], {
				locked: ['item', 'hsn', 'qty', 'taxable', 'gstRate', 'tax', 'amount'],
				required: true,
			}),
			block('totals', ['totals'], { locked: ['totals'], required: true }),
			block('note', ['reason']),
			text,
			block('signature', ['signature'], { locked: ['signature'], required: true }),
			footer,
		],
	},
	receipt: {
		doc: 'receipt',
		group: 'sales',
		gst: true,
		blocks: [
			block('brand', ['logo', 'seller'], { locked: ['seller'], required: true }),
			block('title', []),
			block('facts', ['receiptNo', 'date', 'orderNo', 'placeOfSupply'], {
				locked: ['receiptNo', 'date', 'placeOfSupply'],
				required: true,
			}),
			block('parties', ['payer'], { locked: ['payer'], required: true }),
			block('payment', ['amount', 'method', 'reference', 'taxOnAdvance'], {
				locked: ['amount', 'taxOnAdvance'],
				required: true,
			}),
			block('words', ['amountInWords']),
			text,
			block('signature', ['signature'], { locked: ['signature'], required: true }),
			footer,
		],
	},
	refundVoucher: {
		doc: 'refundVoucher',
		group: 'sales',
		gst: true,
		blocks: [
			block('brand', ['logo', 'seller'], { locked: ['seller'], required: true }),
			block('title', []),
			block('facts', ['voucherNo', 'date', 'receiptNo'], {
				locked: ['voucherNo', 'date', 'receiptNo'],
				required: true,
			}),
			block('parties', ['payee'], { locked: ['payee'], required: true }),
			block('payment', ['amount', 'taxReversed', 'method', 'reference'], {
				locked: ['amount', 'taxReversed'],
				required: true,
			}),
			block('note', ['reason']),
			text,
			block('signature', ['signature'], { locked: ['signature'], required: true }),
			footer,
		],
	},
	deliveryChallan: {
		doc: 'deliveryChallan',
		group: 'sales',
		gst: true,
		blocks: [
			block('brand', ['logo', 'seller'], { locked: ['seller'], required: true }),
			block('title', []),
			block('facts', ['challanNo', 'date', 'purpose', 'transport'], {
				locked: ['challanNo', 'date', 'purpose'],
				required: true,
			}),
			block('parties', ['consignee'], { locked: ['consignee'], required: true }),
			block('table', ['index', 'item', 'hsn', 'qty', 'value'], {
				locked: ['item', 'hsn', 'qty', 'value'],
				required: true,
			}),
			block('totals', ['totals'], { locked: ['totals'] }),
			text,
			block('signature', ['signature'], { locked: ['signature'], required: true }),
			footer,
		],
	},
	packingSlip: {
		doc: 'packingSlip',
		group: 'parcels',
		gst: false,
		blocks: [
			block('brand', ['logo', 'seller']),
			block('title', []),
			block('facts', ['parcelNo', 'orderNo', 'date', 'courier', 'awb'], { required: true }),
			block('parties', ['shipTo']),
			block('table', ['check', 'index', 'item', 'qty', 'cameWith'], { locked: ['item', 'qty'], required: true }),
			text,
			block('signature', ['packedBy']),
			footer,
		],
	},
	returnNote: {
		doc: 'returnNote',
		group: 'parcels',
		gst: false,
		blocks: [
			block('brand', ['logo', 'seller']),
			block('title', []),
			block('facts', ['returnNo', 'orderNo', 'date'], { required: true }),
			block('parties', ['customer']),
			block('table', ['index', 'item', 'qty', 'condition'], { locked: ['item', 'qty'], required: true }),
			block('note', ['reason']),
			block('payment', ['refund']),
			text,
			footer,
		],
	},
	purchaseOrder: {
		doc: 'purchaseOrder',
		group: 'purchases',
		gst: false,
		blocks: [
			block('brand', ['logo', 'buyerShop']),
			block('title', []),
			block('facts', ['poNo', 'date', 'expectedBy'], { required: true }),
			block('parties', ['supplier', 'deliverTo']),
			block('table', ['index', 'item', 'supplierCode', 'qty', 'rate', 'gstRate', 'amount'], {
				locked: ['item', 'qty'],
				required: true,
			}),
			block('totals', ['totals']),
			block('note', ['noteToSupplier']),
			text,
			block('signature', ['signature']),
			footer,
		],
	},
	purchaseEntry: {
		doc: 'purchaseEntry',
		group: 'purchases',
		gst: false,
		blocks: [
			block('brand', ['logo', 'buyerShop']),
			block('title', []),
			block('facts', ['entryNo', 'billNo', 'billDate', 'receivedOn', 'poNo'], { required: true }),
			block('parties', ['supplier']),
			block('table', ['index', 'item', 'hsn', 'ordered', 'received', 'rate', 'taxable', 'gstRate', 'amount'], {
				locked: ['item', 'received'],
				required: true,
			}),
			block('totals', ['totals']),
			text,
			block('signature', ['receivedBy']),
			footer,
		],
	},
	purchaseReturnNote: {
		doc: 'purchaseReturnNote',
		group: 'purchases',
		gst: false,
		blocks: [
			block('brand', ['logo', 'buyerShop']),
			block('title', []),
			block('facts', ['returnNo', 'date', 'entryNo'], { required: true }),
			block('parties', ['supplier']),
			block('table', ['index', 'item', 'qty', 'rate', 'amount'], { locked: ['item', 'qty'], required: true }),
			block('totals', ['totals']),
			block('note', ['reason']),
			text,
			block('signature', ['signature']),
			footer,
		],
	},
	selfInvoice: {
		doc: 'selfInvoice',
		group: 'purchases',
		gst: true,
		blocks: [
			block('brand', ['logo', 'seller'], { locked: ['seller'], required: true }),
			block('title', []),
			block('facts', ['selfInvoiceNo', 'date', 'placeOfSupply'], {
				locked: ['selfInvoiceNo', 'date', 'placeOfSupply'],
				required: true,
			}),
			block('parties', ['supplier'], { locked: ['supplier'], required: true }),
			block('table', ['index', 'item', 'hsn', 'qty', 'rate', 'taxable', 'tax'], {
				locked: ['item', 'hsn', 'qty', 'taxable', 'tax'],
				required: true,
			}),
			block('totals', ['totals'], { locked: ['totals'], required: true }),
			block('note', ['rcmNote'], { locked: ['rcmNote'], required: true }),
			text,
			block('signature', ['signature'], { locked: ['signature'], required: true }),
			footer,
		],
	},
	paymentVoucher: {
		doc: 'paymentVoucher',
		group: 'purchases',
		gst: true,
		blocks: [
			block('brand', ['logo', 'payer'], { locked: ['payer'], required: true }),
			block('title', []),
			block('facts', ['voucherNo', 'date', 'against'], { locked: ['voucherNo', 'date'], required: true }),
			block('parties', ['payee'], { locked: ['payee'], required: true }),
			block('payment', ['amount', 'method', 'reference', 'rcmTax'], { locked: ['amount'], required: true }),
			text,
			block('signature', ['signature'], { locked: ['signature'], required: true }),
			footer,
		],
	},
	stockAdjustment: {
		doc: 'stockAdjustment',
		group: 'stock',
		gst: false,
		blocks: [
			block('brand', ['shop']),
			block('title', []),
			block('facts', ['adjustmentNo', 'date'], { required: true }),
			block('table', ['index', 'item', 'before', 'change', 'after', 'reason'], {
				locked: ['item', 'change'],
				required: true,
			}),
			text,
			block('signature', ['approvedBy']),
			footer,
		],
	},
	stockCount: {
		doc: 'stockCount',
		group: 'stock',
		gst: false,
		blocks: [
			block('brand', ['shop']),
			block('title', []),
			block('facts', ['countNo', 'date', 'area'], { required: true }),
			block('table', ['index', 'item', 'expected', 'counted', 'difference'], {
				locked: ['item', 'counted'],
				required: true,
			}),
			text,
			block('signature', ['countedBy', 'checkedBy']),
			footer,
		],
	},
	openingStock: {
		doc: 'openingStock',
		group: 'stock',
		gst: false,
		blocks: [
			block('brand', ['shop']),
			block('title', []),
			block('facts', ['openingNo', 'date'], { required: true }),
			block('table', ['index', 'item', 'qty', 'cost', 'value'], { locked: ['item', 'qty'], required: true }),
			block('totals', ['totals']),
			text,
			block('signature', ['preparedBy']),
			footer,
		],
	},
	journal: {
		doc: 'journal',
		group: 'stock',
		gst: false,
		blocks: [
			block('brand', ['shop']),
			block('title', []),
			block('facts', ['voucherNo', 'date'], { required: true }),
			block('table', ['account', 'debit', 'credit'], { locked: ['account', 'debit', 'credit'], required: true }),
			block('note', ['narration']),
			text,
			block('signature', ['preparedBy', 'approvedBy']),
			footer,
		],
	},
};

/** The document's spec as the API serves it (the builder's own list of what it may offer). */
export function documentSpec(doc: DocumentKind): DocumentSpec {
	const spec = DOCUMENT_SPECS[doc];
	return {
		...spec,
		tree: spec.tree ?? false,
		blocks: spec.blocks.map(({ ours: _ours, ...rest }) => rest),
	};
}
