/**
 * The lifecycle of every cloud and edge product (brief v7, "the whole lifecycle of every product":
 * list, create, creating, use, edit, monitor, back up, operate, destroy, history). One shape for every
 * DigitalOcean and Cloudflare screen, so the console draws them all the same way from live reads.
 */
import { z } from 'zod';

import { vendorAnswer } from './projects.js';

export const toneSchema = z.enum(['ok', 'amber', 'red', 'cy', 'muted']).nullable();
export type Tone = z.infer<typeof toneSchema>;

export const productCellSchema = z.union([z.string(), z.number(), z.null()]);
export type ProductCell = z.infer<typeof productCellSchema>;

export const productColumnSchema = z.object({
	key: z.string(),
	label: z.string(),
	/** Numbers, addresses and slugs read in the console's fixed-width face. */
	mono: z.boolean().default(false),
});
export type ProductColumn = z.infer<typeof productColumnSchema>;

export const productRowSchema = z.object({
	/** What the Use, Edit, Monitor… tabs open with (`?id=`). Empty when the row opens nothing. */
	id: z.string(),
	name: z.string(),
	cells: z.record(z.string(), productCellSchema),
	tone: toneSchema.default(null),
});
export type ProductRow = z.infer<typeof productRowSchema>;

export const productTableSchema = z.object({
	title: z.string(),
	columns: z.array(productColumnSchema),
	rows: z.array(productRowSchema),
	/** What the table says when it has no rows. */
	empty: z.string(),
	/** True when the rows open a product (Use tab). */
	opens: z.boolean().default(false),
});
export type ProductTable = z.infer<typeof productTableSchema>;

/** [label, value, tone]. */
export const productFactSchema = z.tuple([z.string(), z.string(), toneSchema]);
export type ProductFact = z.infer<typeof productFactSchema>;

export const productStatSchema = z.object({ label: z.string(), value: z.string(), sub: z.string().default('') });
export type ProductStat = z.infer<typeof productStatSchema>;

export const productNoteSchema = z.object({ text: z.string(), tone: toneSchema.default('cy') });
export type ProductNote = z.infer<typeof productNoteSchema>;

export const productLinkSchema = z.object({ label: z.string(), url: z.string().url() });
export type ProductLink = z.infer<typeof productLinkSchema>;

/** A button on a tab that opens one of the product's forms. */
export const productActionSchema = z.object({
	label: z.string(),
	form: z.string(),
	tone: z.enum(['primary', 'danger', 'ghost']).default('ghost'),
});
export type ProductAction = z.infer<typeof productActionSchema>;

/** Which product a tab is about (Use, Edit, Monitor…), chosen from the account's live list. */
export const productPickerSchema = z.object({
	label: z.string(),
	options: z.array(z.object({ value: z.string(), label: z.string() })),
	value: z.string().nullable(),
});
export type ProductPicker = z.infer<typeof productPickerSchema>;

/** Every tab that is not a form or a chart: tiles, facts, tables, notes, links and buttons. */
export const productViewSchema = z.object({
	head: z
		.object({ name: z.string(), status: z.string().default(''), tone: toneSchema.default(null) })
		.nullable()
		.default(null),
	stats: z.array(productStatSchema).default([]),
	notes: z.array(productNoteSchema).default([]),
	facts: z.array(productFactSchema).default([]),
	tables: z.array(productTableSchema).default([]),
	links: z.array(productLinkSchema).default([]),
	actions: z.array(productActionSchema).default([]),
});
export type ProductView = z.infer<typeof productViewSchema>;

export const productSeriesSchema = z.object({
	name: z.string(),
	unit: z.string().default(''),
	/** [unix seconds, value]. */
	points: z.array(z.tuple([z.number(), z.number()])),
});
export type ProductSeries = z.infer<typeof productSeriesSchema>;

export const MONITOR_RANGES = ['1h', '24h', '7d', '30d'] as const;
export const monitorRangeSchema = z.enum(MONITOR_RANGES);
export type MonitorRange = z.infer<typeof monitorRangeSchema>;
export const MONITOR_RANGE_SECONDS: Record<MonitorRange, number> = {
	'1h': 3600,
	'24h': 86_400,
	'7d': 7 * 86_400,
	'30d': 30 * 86_400,
};

export const productMonitorSchema = z.object({
	series: z.array(productSeriesSchema),
	notes: z.array(productNoteSchema).default([]),
});
export type ProductMonitor = z.infer<typeof productMonitorSchema>;

export const productFieldValueSchema = z.union([
	z.string().max(8000),
	z.number(),
	z.boolean(),
	z.array(z.string().max(300)).max(200),
]);
export type ProductFieldValue = z.infer<typeof productFieldValueSchema>;

export const productFieldSchema = z.object({
	key: z.string(),
	label: z.string(),
	/** `secret`: typed into a hidden box, sent once, never shown again or kept by the console. */
	type: z.enum(['text', 'number', 'select', 'toggle', 'multi', 'textarea', 'cards', 'secret']),
	options: z.array(z.object({ value: z.string(), label: z.string(), sub: z.string().default('') })).default([]),
	value: productFieldValueSchema.nullable().default(null),
	help: z.string().default(''),
	required: z.boolean().default(false),
	min: z.number().nullable().default(null),
	max: z.number().nullable().default(null),
	readOnly: z.boolean().default(false),
});
export type ProductField = z.infer<typeof productFieldSchema>;

/** A form the console draws: what is sent, what it costs, and what must be typed to confirm. */
export const productFormSchema = z.object({
	/** The form's key on its screen (create, edit, resize, snapshot, destroy…). */
	key: z.string(),
	title: z.string(),
	submit: z.string(),
	fields: z.array(productFieldSchema),
	/** What it costs, in words ("$10.00 a month for 100 GiB"), or null when free. */
	cost: z.string().nullable().default(null),
	notes: z.array(productNoteSchema).default([]),
	/** Destroying and other one-way changes ask for this name to be typed. */
	confirmName: z.string().nullable().default(null),
	danger: z.boolean().default(false),
	/** Why this form cannot be sent (the vendor or the key does not allow it), in words. */
	blocked: z.string().nullable().default(null),
});
export type ProductForm = z.infer<typeof productFormSchema>;

const pin = z.string().regex(/^\d{6}$/);

export const productWriteSchema = z.object({
	pin,
	/** The product's name, typed by the owner when the form asks for it. */
	confirm: z.string().max(300).default(''),
	id: z.string().max(200).nullable().default(null),
	values: z.record(z.string().max(80), productFieldValueSchema).default({}),
});
export type ProductWrite = z.infer<typeof productWriteSchema>;

export const productStepSchema = z.object({
	label: z.string(),
	detail: z.string().default(''),
	state: z.enum(['queued', 'running', 'done', 'failed']),
});
export type ProductStep = z.infer<typeof productStepSchema>;

/** A change the console sent and follows (Creating and Operate tabs). */
export const productJobSchema = z.object({
	id: z.string(),
	/** The screen and the form that started it. */
	screen: z.string(),
	form: z.string(),
	target: z.string(),
	startedAt: z.string().datetime(),
	finishedAt: z.string().datetime().nullable(),
	state: z.enum(['running', 'done', 'failed']),
	message: z.string(),
	productId: z.string().nullable(),
	steps: z.array(productStepSchema),
});
export type ProductJob = z.infer<typeof productJobSchema>;
export const productJobsSchema = z.array(productJobSchema);

/** What one tab of a product screen shows. */
export const productTabSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('view'),
		picker: productPickerSchema.nullable().default(null),
		view: productViewSchema,
	}),
	z.object({
		type: z.literal('monitor'),
		picker: productPickerSchema.nullable().default(null),
		monitor: productMonitorSchema,
	}),
	z.object({
		type: z.literal('form'),
		picker: productPickerSchema.nullable().default(null),
		form: productFormSchema,
	}),
	/** The changes the console sent from this screen and is following. */
	z.object({ type: z.literal('jobs') }),
]);
export type ProductTab = z.infer<typeof productTabSchema>;

export const productTabAnswerSchema = vendorAnswer(productTabSchema);
export const productFormAnswerSchema = vendorAnswer(productFormSchema);
