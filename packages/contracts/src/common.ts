import { z } from 'zod';

/** Supported content locales (English + Bengali to start; extend as needed). */
export const Locale = z.enum(['en', 'bn']);
export type Locale = z.infer<typeof Locale>;

/**
 * Localized string. Requires `en` (the fallback locale) and allows any other
 * locale key (e.g. `bn`). Mirrors the i18n objects stored in the DB.
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

/** ISO-8601 datetime string (transport representation of dates). */
export const IsoDateTime = z.string().min(1).describe('ISO 8601 datetime string');
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** SEO metadata block (localized title/description, optional). */
export const SeoMeta = z.object({
	title: LocalizedText.optional(),
	description: LocalizedText.optional(),
});
export type SeoMeta = z.infer<typeof SeoMeta>;
