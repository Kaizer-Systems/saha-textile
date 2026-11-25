import type { DocumentKind } from '@saha-textile/contracts';

/**
 * One document's content as every format reads it (bundle builder brief F): the renderer draws only what the
 * format's blocks ask for, so the same data prints in "Saha Textile standard", "Compact" or a layout the shop made.
 * Values arrive formatted ("₹14,760.00", "22 Nov 2026"); the renderer escapes every one of them.
 */
export interface DocumentRow {
	/** `set` is a heading row with no amount or tax; pieces, free items and extras sit under it. */
	kind: 'line' | 'set' | 'piece' | 'free' | 'extra';
	/** 0 for a line of its own, 1 under a set or product, 2 for a free item under a piece. */
	depth: 0 | 1 | 2;
	/** Column key → value. `item` is the name; `sku` and `sub` print under it. */
	cells: Record<string, string>;
	sku?: string;
	/** A smaller line under the name: "share of set", "free with piece 1", a set's price words. */
	sub?: string;
	/** A free item's printed price, struck beside ₹0. */
	struck?: string;
}

export interface DocumentData {
	doc: DocumentKind;
	/** "Tax invoice", "Packing slip". */
	title: string;
	/** The document's own number, printed beside the title and in the footer. */
	number: string;
	/** The date under the number. */
	date: string;
	/** The party block of the brand: the seller, the buying shop, the payer or the shop. */
	seller: { name: string; lines: string[] };
	/** Field → text, for the title (`copyLabel`), facts, e-invoice, e-way bill, payment and note blocks. */
	values: Record<string, string>;
	/** Field → a box of lines with its heading, for the parties block. */
	parties: Record<string, { heading: string; lines: string[] }>;
	/** The tax split's own heading ("CGST + SGST" or "IGST"), for the table's `tax` column. */
	taxHeading?: string;
	/** Table columns this document leaves out whatever its format shows (a bill of supply has no GST rate or tax). */
	hideColumns?: string[];
	rows?: DocumentRow[];
	hsnSummary?: Array<{ hsn: string; taxable: string; rate: string; tax: string }>;
	/** Field → rows; `totals` holds the sums, `roundOff` its own row. The last `totals` row is the total. */
	totals?: Record<string, Array<{ label: string; value: string }>>;
	/** Field → the person or words under a signature line (`declaration`, `signature`, `packedBy`…). */
	signatures?: Record<string, string>;
	/** The QR as an SVG string (e-invoice), drawn as it is. */
	qrSvg?: string;
}
