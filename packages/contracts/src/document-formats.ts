import { z } from 'zod';

import { Id, IsoDateTime } from './common';

/**
 * Document formats (bundle builder brief section F, approved 2026-11-22; owner: the layout builders are in this
 * build). Every printable document has its own list of formats and exactly one active format. A format is data:
 * blocks in order, each naming only fields its document has, so the builder and the renderer read the same record.
 */

/** Every printable document, in the order Settings › Document formats lists them (F01). */
export const DocumentKind = z.enum([
	'taxInvoice',
	'creditNote',
	'debitNote',
	'receipt',
	'refundVoucher',
	'deliveryChallan',
	'packingSlip',
	'returnNote',
	'purchaseOrder',
	'purchaseEntry',
	'purchaseReturnNote',
	'selfInvoice',
	'paymentVoucher',
	'stockAdjustment',
	'stockCount',
	'openingStock',
	'journal',
]);
export type DocumentKind = z.infer<typeof DocumentKind>;

export const DocumentGroup = z.enum(['sales', 'parcels', 'purchases', 'stock']);
export type DocumentGroup = z.infer<typeof DocumentGroup>;

/** Paper a format prints on: A4 or A5 portrait, or an 80 mm counter-printer roll. */
export const DocumentPaper = z.enum(['a4', 'a5', 'roll80']);
export type DocumentPaper = z.infer<typeof DocumentPaper>;

/**
 * What a block draws. `facts` is a grid of the document's own details, `parties` its address boxes, `table` its
 * lines, `note` one of its own written fields (a reason, a narration), `text` words the shop types once.
 */
export const DocumentBlockType = z.enum([
	'brand',
	'title',
	'facts',
	'parties',
	'einvoice',
	'eway',
	'table',
	'hsnSummary',
	'totals',
	'words',
	'payment',
	'note',
	'text',
	'signature',
	'footer',
]);
export type DocumentBlockType = z.infer<typeof DocumentBlockType>;

/** Text sizes for the lines table (F05): a set's heading row, piece rows, free items (points). */
export const DocumentTableSizes = z.object({
	heading: z.number().int().min(8).max(16).optional(),
	piece: z.number().int().min(7).max(14).optional(),
	free: z.number().int().min(7).max(14).optional(),
});
export type DocumentTableSizes = z.infer<typeof DocumentTableSizes>;

export const DocumentBlock = z.object({
	/** Unique within its format; seeded blocks use their type, added text blocks `text-2`, `text-3`… */
	id: z.string().regex(/^[a-z][a-zA-Z0-9-]{0,39}$/),
	type: DocumentBlockType,
	hidden: z.boolean().default(false),
	/** The document's fields this block shows (columns for the table), in order. */
	fields: z.array(z.string().max(40)).max(30).default([]),
	/** A text block's heading and words; empty for every other block. */
	heading: z.string().trim().max(80).default(''),
	text: z.string().trim().max(2000).default(''),
	sizes: DocumentTableSizes.default({}),
});
export type DocumentBlock = z.infer<typeof DocumentBlock>;

export const DocumentFormat = z.object({
	id: Id,
	doc: DocumentKind,
	name: z.string().trim().min(1).max(60),
	about: z.string().trim().max(120).default(''),
	paper: DocumentPaper.default('a4'),
	blocks: z.array(DocumentBlock).min(1).max(40),
	active: z.boolean().default(false),
	/** One of ours, written by the release step; it can be copied and switched off, never deleted. */
	seeded: z.boolean().default(false),
	version: z.number().int().positive().default(1),
	updatedAt: IsoDateTime.nullable().default(null),
	updatedBy: z.string().nullable().default(null),
});
export type DocumentFormat = z.infer<typeof DocumentFormat>;

/** What a document's builder may offer for one kind of block (F04: only that document's fields). */
export const DocumentBlockSpec = z.object({
	type: DocumentBlockType,
	/** Every field this block may show, in the order ours shows them. */
	fields: z.array(z.string()),
	/** Fields the law needs (GSTIN, HSN, the tax split, place of supply): always on. */
	lockedFields: z.array(z.string()).default([]),
	/** The block itself can't be hidden. */
	required: z.boolean().default(false),
});
export type DocumentBlockSpec = z.infer<typeof DocumentBlockSpec>;

export const DocumentSpec = z.object({
	doc: DocumentKind,
	group: DocumentGroup,
	/** Numbered and kept under GST rules (Rule 46 and the rules naming each voucher). */
	gst: z.boolean(),
	/** Prints lines as a tree: a set's heading row, its pieces and free items indented (F, "How a set prints"). */
	tree: z.boolean().default(false),
	blocks: z.array(DocumentBlockSpec),
});
export type DocumentSpec = z.infer<typeof DocumentSpec>;

/** Settings › Document formats, one table per document (F01). */
export const DocumentFormatsView = z.object({
	groups: z.array(
		z.object({
			group: DocumentGroup,
			documents: z.array(
				z.object({
					doc: DocumentKind,
					/** "TI/26-27/000124", from Settings › Document numbers; null where the document has no series yet. */
					numberExample: z.string().nullable(),
					spec: DocumentSpec,
					formats: z.array(DocumentFormat),
				}),
			),
		}),
	),
});
export type DocumentFormatsView = z.infer<typeof DocumentFormatsView>;

/** Make new layout (F04): which document, from our format or blank, and a name. */
export const DocumentFormatCreate = z.object({
	doc: DocumentKind,
	from: z.enum(['ours', 'blank']).default('ours'),
	name: z.string().trim().min(1).max(60),
});
export type DocumentFormatCreate = z.infer<typeof DocumentFormatCreate>;

/** Save format (F05). `version` must be the one the builder opened, so two people can't overwrite each other. */
export const DocumentFormatWrite = z.object({
	name: z.string().trim().min(1).max(60),
	about: z.string().trim().max(120).default(''),
	paper: DocumentPaper,
	blocks: z.array(DocumentBlock).min(1).max(40),
	version: z.number().int().positive(),
});
export type DocumentFormatWrite = z.infer<typeof DocumentFormatWrite>;

/** The builder's live preview: unsaved blocks and paper, drawn with the document's sample. */
export const DocumentFormatPreview = z.object({
	paper: DocumentPaper,
	blocks: z.array(DocumentBlock).min(1).max(40),
});
export type DocumentFormatPreview = z.infer<typeof DocumentFormatPreview>;

/** Switching on (F02) says which format went off; switching off is refused (F03) with the reason. */
export const DocumentFormatSwitchResult = z.object({
	active: DocumentFormat,
	switchedOff: DocumentFormat.nullable(),
});
export type DocumentFormatSwitchResult = z.infer<typeof DocumentFormatSwitchResult>;

export const DocumentFormatProblem = z.object({
	code: z.enum([
		'unknown_block',
		'field_not_allowed',
		'locked_field_missing',
		'required_block_missing',
		'required_block_hidden',
		'duplicate_block',
		'duplicate_id',
	]),
	blockId: z.string().nullable(),
	field: z.string().nullable(),
});
export type DocumentFormatProblem = z.infer<typeof DocumentFormatProblem>;
