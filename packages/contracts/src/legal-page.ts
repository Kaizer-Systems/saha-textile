import { z } from 'zod';

import { Id, IsoDateTime, LocalizedText } from './common';

/**
 * The four legal pages (Legal Pages brief, choice A, approved 15 Nov 2026): written in Admin › Pages in every shop
 * language, kept in the database, read by the shop. Their addresses never change: the footer, the cookie box,
 * checkout and search engines link to them.
 */
export const LEGAL_PAGE_SLUGS = ['privacy-policy', 'terms-conditions', 'refund-returns', 'shipping-policy'] as const;
export const LegalPageSlug = z.enum(LEGAL_PAGE_SLUGS);
export type LegalPageSlug = z.infer<typeof LegalPageSlug>;

/** The fields a page needs in every language the shop shows before it can be saved. */
export const LEGAL_PAGE_REQUIRED = ['title', 'content'] as const;
export type LegalPageField = (typeof LEGAL_PAGE_REQUIRED)[number];

/** `PATCH /admin/pages/:slug`: the page's words per language (content is cleaned on save) and its share picture. */
export const LegalPageWrite = z.object({
	title: LocalizedText,
	content: LocalizedText,
	metaTitle: LocalizedText.default({}),
	metaDescription: LocalizedText.default({}),
	metaImageAssetId: Id.nullable().default(null),
});
export type LegalPageWrite = z.infer<typeof LegalPageWrite>;

/** A legal page as stored. Every save writes a new version; earlier ones are kept (choice 3). */
export const LegalPage = LegalPageWrite.extend({
	slug: LegalPageSlug,
	version: z.number().int().positive(),
	updatedAt: IsoDateTime,
	updatedBy: Id.nullable(),
});
export type LegalPage = z.infer<typeof LegalPage>;

/** Admin › Pages list (P1) and form (P3): the page, who saved it last, and what each language still misses. */
export const AdminLegalPage = z.object({
	page: LegalPage,
	updatedByName: z.string().nullable(),
	/** Per language the shop shows or is preparing: the required fields still empty. */
	gaps: z.record(z.string(), z.array(z.enum(LEGAL_PAGE_REQUIRED))),
	metaImageUrl: z.string().nullable(),
});
export type AdminLegalPage = z.infer<typeof AdminLegalPage>;

/** `GET /catalog/pages/:slug?locale=`: one language of a page for the shop (P8, P9). */
export const PublicLegalPage = z.object({
	slug: LegalPageSlug,
	title: z.string(),
	content: z.string(),
	metaTitle: z.string(),
	metaDescription: z.string(),
	shareImageUrl: z.string().nullable(),
	/** Shown as “Last updated” under the title (choice 2). */
	updatedAt: IsoDateTime,
});
export type PublicLegalPage = z.infer<typeof PublicLegalPage>;

/** `GET /catalog/pages/:slug?locale=`: the language the shop draws (English when absent). */
export const PublicLegalPageQuery = z.object({ locale: z.string().min(2).max(12).default('en') });
export type PublicLegalPageQuery = z.infer<typeof PublicLegalPageQuery>;
