import { z } from 'zod';

import { Id, IsoDateTime, LocalizedText } from './common';
import { GoLiveGap } from './catalog-write';
import { ResolvedImage } from './media';

/**
 * Launch and sale events (owner log § launch and sale events, 2026-11-09).
 *
 * A launch puts draft categories and products live at its start time and never ends. A sale
 * gives products a sale price between its start and end times. Nothing on the shop changes
 * until the owner presses Publish; the clock then does the rest. Sale prices are an overlay
 * read at price time, so no product price is ever rewritten and nothing has to be put back.
 *
 * Times are entered in India time (IST) and stored in UTC. Shoppers see the moment as fixed
 * IST text, and a live countdown that ticks from the server's clock.
 */

export const ShopEventType = z.enum(['launch', 'sale']);
export type ShopEventType = z.infer<typeof ShopEventType>;

/**
 * draft → scheduled (Publish) → live (the start time) → ended (a sale's end time).
 * Unpublish returns a scheduled event to draft. Cancel ends any published event for good.
 * A launch stays `live`: it has no end.
 */
export const ShopEventStatus = z.enum(['draft', 'scheduled', 'live', 'ended', 'cancelled']);
export type ShopEventStatus = z.infer<typeof ShopEventStatus>;

/** The three kinds of discount. `fixed` is a sale price; per-SKU prices can override it. */
export const SaleRuleKind = z.enum(['percent', 'amount', 'fixed']);
export type SaleRuleKind = z.infer<typeof SaleRuleKind>;

const Rupees = z.number().int().nonnegative();

export const SaleRule = z.object({
	kind: SaleRuleKind,
	/** Percent for `percent`, whole rupees for `amount` and `fixed`. */
	value: z.number().nonnegative(),
	/** `fixed` only: a sale price per SKU, for a product with several price rows. */
	skuPrices: z.record(z.string(), Rupees).default({}),
});
export type SaleRule = z.infer<typeof SaleRule>;

/** One product inside a category that does not follow the category rule. */
export const SaleException = z.object({
	productId: Id,
	/** `held`: no sale price at all. `own`: the product's own rule. */
	mode: z.enum(['held', 'own']),
	rule: SaleRule.nullable().default(null),
});
export type SaleException = z.infer<typeof SaleException>;

export const SaleCategoryLine = z.object({
	categoryId: Id,
	rule: SaleRule,
	exceptions: z.array(SaleException).max(500).default([]),
});
export type SaleCategoryLine = z.infer<typeof SaleCategoryLine>;

export const SaleProductLine = z.object({
	productId: Id,
	rule: SaleRule,
});
export type SaleProductLine = z.infer<typeof SaleProductLine>;

export const SaleSetup = z.object({
	categories: z.array(SaleCategoryLine).max(100).default([]),
	products: z.array(SaleProductLine).max(1_000).default([]),
});
export type SaleSetup = z.infer<typeof SaleSetup>;

export const LaunchSetup = z.object({
	/** Draft categories that go live at the start. Their draft products come with them. */
	categoryIds: z.array(Id).max(100).default([]),
	/** Single draft products outside those categories. */
	productIds: z.array(Id).max(1_000).default([]),
	/** Draft products inside a picked category that stay draft. */
	heldProductIds: z.array(Id).max(1_000).default([]),
});
export type LaunchSetup = z.infer<typeof LaunchSetup>;

/** What the start of a launch did, item by item. */
export const LaunchReport = z.object({
	liveProductIds: z.array(Id).default([]),
	liveCategoryIds: z.array(Id).default([]),
	/** Already live by hand before the start: left alone. */
	skippedProductIds: z.array(Id).default([]),
	/** Edited since Publish and no longer ready: still draft. */
	failed: z.array(z.object({ productId: Id, gaps: z.array(GoLiveGap) })).default([]),
});
export type LaunchReport = z.infer<typeof LaunchReport>;

/** The compact record a sale keeps after it ends: each SKU's prices and what it sold. */
export const SaleRecordRow = z.object({
	productId: Id,
	sku: z.string(),
	normalINR: Rupees,
	saleINR: Rupees,
	unitsSold: z.number().int().nonnegative(),
	revenueINR: Rupees,
	discountINR: Rupees,
});
export type SaleRecordRow = z.infer<typeof SaleRecordRow>;

export const SaleRecord = z.object({
	rows: z.array(SaleRecordRow).default([]),
	orders: z.number().int().nonnegative().default(0),
	unitsSold: z.number().int().nonnegative().default(0),
	revenueINR: Rupees.default(0),
	discountINR: Rupees.default(0),
});
export type SaleRecord = z.infer<typeof SaleRecord>;

export const ShopEvent = z.object({
	id: Id,
	type: ShopEventType,
	/** Admin only, for example "Durga Puja Collection 2027". */
	name: z.string().min(1).max(120),
	/** The line the top bar, the phone strip and the popup heading show. */
	title: LocalizedText.default({}),
	/** The customer message: the popup's paragraph and the email body. Plain text. */
	message: LocalizedText.default({}),
	startsAt: IsoDateTime.nullable().default(null),
	/** A sale's end. Always null for a launch. */
	endsAt: IsoDateTime.nullable().default(null),
	/** Where the top bar line, the popup button and the message lead. A shop path. */
	linkHref: z.string().max(500).nullable().default(null),
	showCountdown: z.boolean().default(true),
	showPopup: z.boolean().default(true),
	popupAssetId: Id.nullable().default(null),
	/** A launch keeps a "Now live" line in the top bar this many days after its start. */
	nowLiveDays: z.number().int().min(0).max(60).default(3),
	launch: LaunchSetup.default({ categoryIds: [], productIds: [], heldProductIds: [] }),
	sale: SaleSetup.default({ categories: [], products: [] }),
	status: ShopEventStatus.default('draft'),
	publishedAt: IsoDateTime.nullable().default(null),
	startedAt: IsoDateTime.nullable().default(null),
	endedAt: IsoDateTime.nullable().default(null),
	cancelledAt: IsoDateTime.nullable().default(null),
	messageSentAt: IsoDateTime.nullable().default(null),
	launchReport: LaunchReport.nullable().default(null),
	saleRecord: SaleRecord.nullable().default(null),
	createdAt: IsoDateTime.optional(),
	updatedAt: IsoDateTime.optional(),
});
export type ShopEvent = z.infer<typeof ShopEvent>;

// ── Admin writes ───────────────────────────────────────────────────────────────

const Text = z.record(z.string(), z.string().max(300));
const MessageText = z.record(z.string(), z.string().max(2_000));

/** The event form. The type is fixed by the first save. */
export const ShopEventWrite = z.object({
	name: z.string().trim().min(1).max(120),
	title: Text.default({}),
	message: MessageText.default({}),
	startsAt: IsoDateTime.nullable().default(null),
	endsAt: IsoDateTime.nullable().default(null),
	linkHref: z
		.string()
		.trim()
		.max(500)
		.regex(/^\/[^\s]*$/, 'must be a shop path such as /collections/durga-puja')
		.nullable()
		.default(null),
	showCountdown: z.boolean().default(true),
	showPopup: z.boolean().default(true),
	popupAssetId: Id.nullable().default(null),
	nowLiveDays: z.number().int().min(0).max(60).default(3),
	launch: LaunchSetup.default({ categoryIds: [], productIds: [], heldProductIds: [] }),
	sale: SaleSetup.default({ categories: [], products: [] }),
});
export type ShopEventWrite = z.infer<typeof ShopEventWrite>;

export const ShopEventCreate = ShopEventWrite.extend({ type: ShopEventType });
export type ShopEventCreate = z.infer<typeof ShopEventCreate>;

/** A running sale may move only its end time, through the form or End now. */
export const ShopEventEndWrite = z.object({ endsAt: IsoDateTime });
export type ShopEventEndWrite = z.infer<typeof ShopEventEndWrite>;

export const AdminShopEventListQuery = z.object({
	search: z.string().max(100).optional(),
	type: ShopEventType.optional(),
	status: ShopEventStatus.optional(),
	page: z.coerce.number().int().positive().default(1),
	pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type AdminShopEventListQuery = z.infer<typeof AdminShopEventListQuery>;

export const AdminShopEventListResponse = z.object({
	items: z.array(ShopEvent),
	total: z.number().int().nonnegative(),
	page: z.number().int().positive(),
	pageSize: z.number().int().positive(),
});
export type AdminShopEventListResponse = z.infer<typeof AdminShopEventListResponse>;

/** Why an event can't be saved or published: one problem per line, in the admin's words. */
export const ShopEventProblem = z.object({
	code: z.enum([
		'missing_text',
		'missing_start',
		'missing_end',
		'start_passed',
		'end_before_start',
		'no_items',
		'not_draft',
		'not_ready',
		'bad_rule',
		'overlap',
		'unknown_item',
	]),
	/** The field or item the problem belongs to: `title:bn`, a product id, a category id. */
	target: z.string().default(''),
	locale: z.string().nullable().default(null),
	/** Go Live gaps for `not_ready`; the clashing sale's name for `overlap`. */
	gaps: z.array(GoLiveGap).default([]),
	detail: z.string().default(''),
});
export type ShopEventProblem = z.infer<typeof ShopEventProblem>;

export const ShopEventPublishResult = z.object({
	published: z.boolean(),
	problems: z.array(ShopEventProblem),
	event: ShopEvent.nullable(),
	/** How many people the message went to (or will go to, on a dry run). */
	recipients: z.number().int().nonnegative(),
});
export type ShopEventPublishResult = z.infer<typeof ShopEventPublishResult>;

/** One item on the Items tab or the Review tab, with what the admin needs to see. */
export const ShopEventItemRow = z.object({
	productId: Id,
	sku: z.string(),
	title: z.string(),
	status: z.string(),
	/** Where the item came from: a picked category, or picked on its own. */
	categoryId: Id.nullable(),
	held: z.boolean(),
	/** Launch: Go Live gaps; empty means ready. */
	gaps: z.array(GoLiveGap).default([]),
});
export type ShopEventItemRow = z.infer<typeof ShopEventItemRow>;

/** The Review tab of a sale: every SKU's final price and the rule it came from. */
export const ShopEventPriceRow = z.object({
	productId: Id,
	productTitle: z.string(),
	sku: z.string(),
	normalINR: Rupees,
	saleINR: Rupees.nullable(),
	/** `product`, `exception`, `category`, or `held`. */
	source: z.enum(['product', 'exception', 'category', 'held']),
	/** The category the rule came from, when it came from one. */
	categoryId: Id.nullable(),
	/** More than 60% off: probably a typing slip. */
	warning: z.boolean(),
	/** The rule cannot apply to this price: ₹ 0 or less, above normal, or more off than the price. */
	refused: z.boolean(),
});
export type ShopEventPriceRow = z.infer<typeof ShopEventPriceRow>;

export const ShopEventReview = z.object({
	items: z.array(ShopEventItemRow),
	prices: z.array(ShopEventPriceRow),
	problems: z.array(ShopEventProblem),
	recipients: z.number().int().nonnegative(),
});
export type ShopEventReview = z.infer<typeof ShopEventReview>;

/** The products in one category, for the launch item list and the sale exceptions modal. */
export const ShopEventCategoryProducts = z.object({
	categoryId: Id,
	products: z.array(
		z.object({
			productId: Id,
			sku: z.string(),
			title: z.string(),
			status: z.string(),
			skus: z.array(z.object({ sku: z.string(), normalINR: Rupees })),
		}),
	),
});
export type ShopEventCategoryProducts = z.infer<typeof ShopEventCategoryProducts>;

// ── Public read ────────────────────────────────────────────────────────────────

/** One published event as the shop shows it, in one language. */
export const PublicShopEvent = z.object({
	id: Id,
	type: ShopEventType,
	title: z.string(),
	message: z.string(),
	/** `upcoming` before the start, `running` during a sale, `launched` after a launch's start. */
	phase: z.enum(['upcoming', 'running', 'launched']),
	startsAt: IsoDateTime,
	endsAt: IsoDateTime.nullable(),
	/** The moment the countdown runs to: the start, or a running sale's end. Null after a launch. */
	countdownTo: IsoDateTime.nullable(),
	/** When the popup stops for good: a sale's end, or 60 days after a launch's start. */
	popupUntil: IsoDateTime.nullable(),
	/** The top bar line stays until then. */
	stripUntil: IsoDateTime.nullable(),
	showCountdown: z.boolean(),
	linkHref: z.string().nullable(),
	popupImage: ResolvedImage.nullable(),
});
export type PublicShopEvent = z.infer<typeof PublicShopEvent>;

export const PublicShopEventsResponse = z.object({
	/** The server's clock, so a shopper's wrong clock can't change the countdown. */
	serverNow: IsoDateTime,
	items: z.array(PublicShopEvent),
});
export type PublicShopEventsResponse = z.infer<typeof PublicShopEventsResponse>;

export const PublicShopEventsQuery = z.object({
	locale: z
		.string()
		.regex(/^[a-z]{2}$/)
		.default('en'),
});
export type PublicShopEventsQuery = z.infer<typeof PublicShopEventsQuery>;

/** Every media asset an event points at; the media garbage collector reads this list. */
export const shopEventAssetIds = (event: Pick<ShopEvent, 'popupAssetId'>): string[] =>
	event.popupAssetId ? [event.popupAssetId] : [];

// ── India time ────────────────────────────────────────────────────────────────
// India keeps one offset all year (+05:30, no daylight saving), so the conversion is exact
// arithmetic and never depends on the computer's own time zone.

const IST_OFFSET_MINUTES = 330;

/** `2027-09-27T23:59` typed as India time → the UTC instant. Null when it isn't a valid time. */
export function istInputToUtc(local: string): string | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
	if (!match) return null;
	const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
	const utc = Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET_MINUTES * 60_000;
	const check = new Date(utc + IST_OFFSET_MINUTES * 60_000);
	if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) return null;
	return new Date(utc).toISOString();
}

/** A UTC instant → `2027-09-27T23:59` in India time, for a date-and-time input. */
export function utcToIstInput(iso: string): string {
	const shifted = new Date(new Date(iso).getTime() + IST_OFFSET_MINUTES * 60_000);
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(
		shifted.getUTCHours(),
	)}:${pad(shifted.getUTCMinutes())}`;
}
