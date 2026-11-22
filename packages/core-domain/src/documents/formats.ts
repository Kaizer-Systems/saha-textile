import type {
	DocumentBlock,
	DocumentFormat,
	DocumentFormatProblem,
	DocumentKind,
	DocumentPaper,
} from '@saha-textile/contracts';

import { DOCUMENT_SPECS } from './specs';

/**
 * Document formats' rules (bundle builder brief F01–F05, approved 2026-11-22): our own format for every document,
 * a blank start, the checks a saved format must pass, and "exactly one active format per document".
 */

const blockOf = (
	type: DocumentBlock['type'],
	fields: string[],
	extra: Partial<Pick<DocumentBlock, 'id' | 'heading' | 'text' | 'sizes' | 'hidden'>> = {},
): DocumentBlock => ({
	id: extra.id ?? type,
	type,
	hidden: extra.hidden ?? false,
	fields,
	heading: extra.heading ?? '',
	text: extra.text ?? '',
	sizes: extra.sizes ?? {},
});

/** Words our tax invoice prints under its lines (F05): the returns note and how sets are billed. */
const INVOICE_TEXTS: DocumentBlock[] = [
	blockOf('text', [], {
		id: 'text-returns',
		heading: 'Notes: returns',
		text: 'Unused items with their tags can be returned within 7 days of delivery. A piece of a set is refunded at its share of the set price.',
	}),
	blockOf('text', [], {
		id: 'text-sets',
		heading: 'How sets are billed',
		text: 'A set is a heading, not a sale of its own: each piece is billed with its own HSN, rate and its share of the set price. The shares add up to the set price.',
	}),
];

/** Our format's blocks for a document: every block in order with the fields ours shows (F01: "Ours, made for this shop"). */
export function ourBlocks(doc: DocumentKind): DocumentBlock[] {
	const spec = DOCUMENT_SPECS[doc];
	const out: DocumentBlock[] = [];
	for (const item of spec.blocks) {
		if (item.type === 'text') {
			if (doc === 'taxInvoice') out.push(...INVOICE_TEXTS);
			continue;
		}
		const sizes = item.type === 'table' && spec.tree ? { heading: 11, piece: 10, free: 10 } : {};
		out.push(blockOf(item.type, [...(item.ours ?? item.fields)], { sizes }));
	}
	return out;
}

/** A blank start (F04 "Blank"): only the blocks the document can't do without, with the fields the law needs. */
export function blankBlocks(doc: DocumentKind): DocumentBlock[] {
	return DOCUMENT_SPECS[doc].blocks
		.filter((item) => item.required)
		.map((item) =>
			blockOf(item.type, item.lockedFields.length ? [...item.lockedFields] : [...(item.ours ?? item.fields)]),
		);
}

/** The next free id for an added text block: `text-2`, `text-3`… */
export function nextTextBlockId(blocks: readonly DocumentBlock[]): string {
	const taken = new Set(blocks.map((item) => item.id));
	for (let n = 2; ; n += 1) if (!taken.has(`text-${n}`)) return `text-${n}`;
}

/**
 * What stops a format from being saved: a block or field its document doesn't have, a field the law needs left
 * off, a block the document needs missing or hidden, a block twice (only text blocks may repeat), an id twice.
 */
export function checkFormatBlocks(doc: DocumentKind, blocks: readonly DocumentBlock[]): DocumentFormatProblem[] {
	const spec = DOCUMENT_SPECS[doc];
	const problems: DocumentFormatProblem[] = [];
	const problem = (code: DocumentFormatProblem['code'], blockId: string | null, field: string | null = null) =>
		problems.push({ code, blockId, field });
	const ids = new Set<string>();
	const types = new Set<string>();
	for (const item of blocks) {
		if (ids.has(item.id)) problem('duplicate_id', item.id);
		ids.add(item.id);
		const allowed = spec.blocks.find((row) => row.type === item.type);
		if (!allowed) {
			problem('unknown_block', item.id);
			continue;
		}
		if (item.type !== 'text') {
			if (types.has(item.type)) problem('duplicate_block', item.id);
			types.add(item.type);
		}
		for (const field of item.fields) {
			if (!allowed.fields.includes(field)) problem('field_not_allowed', item.id, field);
		}
		for (const field of allowed.lockedFields) {
			if (!item.fields.includes(field)) problem('locked_field_missing', item.id, field);
		}
		if (allowed.required && item.hidden) problem('required_block_hidden', item.id);
	}
	for (const item of spec.blocks.filter((row) => row.required)) {
		if (!blocks.some((row) => row.type === item.type)) problem('required_block_missing', null, item.type);
	}
	return problems;
}

/** Switching a format on (F02): it becomes the document's active format and the one that was active goes off. */
export function switchOnPlan(
	formats: readonly DocumentFormat[],
	id: string,
): { on: DocumentFormat; off: DocumentFormat | null } | null {
	const on = formats.find((row) => row.id === id);
	if (!on) return null;
	const off = formats.find((row) => row.doc === on.doc && row.active && row.id !== id) ?? null;
	return { on, off };
}

/**
 * Switching the active format off is always refused (F03): a document needs one active format. With only one format
 * the shop must make another layout first; with others it switches one of them on instead.
 */
export function switchOffRefusal(formats: readonly DocumentFormat[], id: string): 'only_format' | 'switch_another' {
	const format = formats.find((row) => row.id === id);
	const siblings = formats.filter((row) => row.doc === format?.doc);
	return siblings.length <= 1 ? 'only_format' : 'switch_another';
}

/** Seeded formats have fixed ids, so every environment's release step writes the same records. */
export const seededFormatId = (doc: DocumentKind, key: 'standard' | 'compact' | 'counter'): string =>
	`dfm_${doc}_${key}`;

const PAPER_ABOUT: Record<'standard' | 'compact' | 'counter', { name: string; about: string; paper: DocumentPaper }> = {
	standard: { name: 'Saha Textile standard', about: 'Ours, made for this shop', paper: 'a4' },
	compact: { name: 'Compact', about: 'Copy of the standard, smaller', paper: 'a5' },
	counter: { name: 'Counter receipt', about: 'For a shop counter printer', paper: 'roll80' },
};

/**
 * Our formats (F01): "Saha Textile standard" for every document, switched on; the tax invoice also has "Compact"
 * (A5) and "Counter receipt" (80 mm roll), switched off, to choose between.
 */
export function seedDocumentFormats(): DocumentFormat[] {
	const out: DocumentFormat[] = [];
	const make = (doc: DocumentKind, key: 'standard' | 'compact' | 'counter', blocks: DocumentBlock[]) =>
		out.push({
			id: seededFormatId(doc, key),
			doc,
			...PAPER_ABOUT[key],
			blocks,
			active: key === 'standard',
			seeded: true,
			version: 1,
			updatedAt: null,
			updatedBy: null,
		});
	for (const doc of Object.keys(DOCUMENT_SPECS) as DocumentKind[]) make(doc, 'standard', ourBlocks(doc));
	make(
		'taxInvoice',
		'compact',
		ourBlocks('taxInvoice').map((item) =>
			item.type === 'table' ? { ...item, sizes: { heading: 10, piece: 9, free: 9 } } : item,
		),
	);
	// A counter roll is narrow: the lines keep only what the law needs, the notes and e-documents stay off.
	const counterHidden = new Set(['einvoice', 'eway', 'hsnSummary', 'words', 'text']);
	make(
		'taxInvoice',
		'counter',
		ourBlocks('taxInvoice').map((item) => {
			if (item.type === 'table') {
				return { ...item, fields: ['item', 'hsn', 'qty', 'taxable', 'gstRate', 'tax', 'amount'], sizes: {} };
			}
			if (item.type === 'parties') return { ...item, fields: ['billTo', 'buyerGstin'] };
			return counterHidden.has(item.type) ? { ...item, hidden: true } : item;
		}),
	);
	return out;
}
