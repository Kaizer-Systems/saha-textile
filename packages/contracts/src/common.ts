import { z } from 'zod';

/**
 * The locked primary/fallback locale. English is the primary locale and every
 * `I18nString` must carry it (owner lock: i18n section).
 */
export const PRIMARY_LOCALE = 'en';

/**
 * A locale code: BCP-47 primary subtag plus an optional region (`en`, `fr`, `bn`, `en-IN`).
 *
 * Deliberately NOT an enum. Which locales a deployment actually serves is
 * CONFIGURATION, not a contract constant — the active set has already moved once
 * (en+bn → en+fr, with Bengali now only an illustrative next candidate). Keeping the
 * set in `ActiveLocaleConfig` means adding, swapping, or retiring a locale is a config
 * change, never a contracts/API change.
 */
export const LocaleCode = z
	.string()
	.regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/, 'must be a locale code such as `en`, `fr`, or `en-IN`');
export type LocaleCode = z.infer<typeof LocaleCode>;

/**
 * Which locales this deployment serves, and which one is the default. Validated
 * wherever locale configuration enters the system (API env/config, admin settings).
 */
export const ActiveLocaleConfig = z
	.object({
		default: LocaleCode.default(PRIMARY_LOCALE),
		active: z.array(LocaleCode).min(1),
	})
	.refine((config) => config.active.includes(config.default), {
		message: '`active` must contain the `default` locale',
		path: ['active'],
	})
	.refine((config) => config.active.includes(PRIMARY_LOCALE), {
		message: 'the primary locale `en` must stay active (I18nString requires it)',
		path: ['active'],
	});
export type ActiveLocaleConfig = z.infer<typeof ActiveLocaleConfig>;

/**
 * Localized string. Requires `en` (the fallback locale) and allows any other
 * locale key (e.g. `fr`). Mirrors the i18n objects stored in the DB.
 */
export const I18nString = z.object({ en: z.string() }).catchall(z.string());
export type I18nString = z.infer<typeof I18nString>;

/** Loose localized map (may be empty / partial) — used for optional SEO fields. */
export const LocalizedText = z.record(z.string(), z.string());
export type LocalizedText = z.infer<typeof LocalizedText>;

/** Domain identifier (string ids such as `cat_pure_silk`, `prod_5557`). */
export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;

/** Lowercase, hyphen-separated URL slug. */
export const Slug = z
	.string()
	.min(1)
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase, hyphen-separated slug');
export type Slug = z.infer<typeof Slug>;

/**
 * Canonical price, always in INR (rupees). Per the architecture, all other
 * currencies are derived at request time in the backend — never stored.
 */
export const PriceINR = z.number().finite().nonnegative();
export type PriceINR = z.infer<typeof PriceINR>;

/** ISO 4217 currency code (uppercase alpha-3), e.g. `INR`, `USD`. */
export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/, 'must be an ISO 4217 alpha-3 code');
export type CurrencyCode = z.infer<typeof CurrencyCode>;

/**
 * A money amount in a specific currency — the TRANSPORT shape for an amount that has
 * already been computed server-side (a converted display price, a quoted shipping
 * charge, an order total).
 *
 * It is never an input to money math: canonical storage stays `PriceINR`, and every
 * conversion/gross-up/tax computation runs server-side behind a strategy that reads
 * config. A client must never send a `Money` and expect it to be trusted.
 */
export const Money = z.object({
	currency: CurrencyCode,
	amount: z.number().finite(),
});
export type Money = z.infer<typeof Money>;

/** ISO-8601 datetime string (transport representation of dates). */
export const IsoDateTime = z.string().min(1).describe('ISO 8601 datetime string');
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** SEO metadata block (localized title/description, optional). */
export const SeoMeta = z.object({
	title: LocalizedText.optional(),
	description: LocalizedText.optional(),
});
export type SeoMeta = z.infer<typeof SeoMeta>;

/**
 * Default and maximum page size for paginated list endpoints. Transport defaults,
 * not business policy — a surface may narrow them, and no endpoint may exceed
 * `MAX_PAGE_SIZE` (unbounded reads are how list endpoints become an availability risk).
 */
export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 200;

/** Standard page/pageSize query for every paginated list endpoint. */
export const PageQuery = z.object({
	page: z.number().int().positive().default(1),
	pageSize: z.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PageQuery = z.infer<typeof PageQuery>;

/** Pagination metadata returned alongside a page of items. */
export const PageMeta = z.object({
	page: z.number().int().positive(),
	pageSize: z.number().int().positive(),
	total: z.number().int().nonnegative(),
	totalPages: z.number().int().nonnegative(),
	hasNext: z.boolean(),
	hasPrev: z.boolean(),
});
export type PageMeta = z.infer<typeof PageMeta>;

/**
 * Builds the standard `{ items, meta }` page envelope for an item schema, so every
 * list response has the same shape:
 *
 *     export const ProductListResponse = paginated(Product);
 */
export const paginated = <TItem extends z.ZodType>(item: TItem) =>
	z.object({
		items: z.array(item),
		meta: PageMeta,
	});

/** Typed view of a page envelope (mirrors `paginated()` output). */
export type Paginated<TItem> = { items: TItem[]; meta: PageMeta };

/**
 * Stable, machine-readable API error codes. Kept deliberately small and transport-shaped
 * (HTTP-status-aligned); domain-specific detail belongs in `issues`, not in new codes.
 */
export const ApiErrorCode = z.enum([
	'bad_request',
	'validation_failed',
	'unauthorized',
	'forbidden',
	'not_found',
	'conflict',
	'rate_limited',
	'payload_too_large',
	'unsupported_media_type',
	'internal',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

/** One field-level validation problem (Zod issue, flattened for transport). */
export const FieldIssue = z.object({
	path: z.array(z.union([z.string(), z.number()])).default([]),
	message: z.string().min(1),
	code: z.string().optional(),
});
export type FieldIssue = z.infer<typeof FieldIssue>;

/**
 * The single error shape every endpoint returns on failure.
 *
 * Fail closed and never leak internals (AGENTS §6): `message` is safe for a client to
 * display, and stack traces, driver/provider payloads, SQL/Mongo detail, and internal
 * identifiers never appear here. `requestId` is what support correlates against the logs.
 */
export const ApiError = z.object({
	code: ApiErrorCode,
	message: z.string().min(1),
	issues: z.array(FieldIssue).default([]),
	requestId: z.string().nullable().default(null),
});
export type ApiError = z.infer<typeof ApiError>;

/** Error response envelope: `{ "error": { ... } }`. */
export const ApiErrorResponse = z.object({ error: ApiError });
export type ApiErrorResponse = z.infer<typeof ApiErrorResponse>;
