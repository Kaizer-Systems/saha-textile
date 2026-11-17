import type { LegalPage, LegalPageField, LegalPageWrite } from '@saha-textile/contracts';

import { sanitizeArticleHtml } from '../blog/sanitize-html';

const REQUIRED: readonly LegalPageField[] = ['title', 'content'];

/** Text that is only markup or spaces counts as empty: `<p><br></p>` is not a policy. */
const filled = (value: string | undefined): boolean =>
	!!value &&
	value
		.replace(/<[^>]*>/g, '')
		.replace(/&nbsp;/g, ' ')
		.trim().length > 0;

/** What each language still misses (P6): Title and Content are needed in every language listed. */
export function legalPageGaps(
	page: Pick<LegalPageWrite, 'title' | 'content'>,
	locales: readonly string[],
): Record<string, LegalPageField[]> {
	return Object.fromEntries(
		locales.map((locale) => [locale, REQUIRED.filter((field) => !filled(page[field][locale]))]),
	);
}

/**
 * A save as stored (Legal Pages brief, Rules): words trimmed, empty languages left out, the content cleaned the way
 * blog posts are (formatting, headings, lists, tables, links and pictures stay; scripts and styles go), and the next
 * version number. The slug never changes.
 */
export function legalPageToSave(input: {
	slug: LegalPage['slug'];
	write: LegalPageWrite;
	current: LegalPage | null;
	actor: string | null;
	now: Date;
}): LegalPage {
	const text = (map: Readonly<Record<string, string>>) =>
		Object.fromEntries(
			Object.entries(map)
				.map(([locale, value]) => [locale, value.trim()] as const)
				.filter(([, value]) => value.length > 0),
		);
	return {
		slug: input.slug,
		title: text(input.write.title),
		content: Object.fromEntries(
			Object.entries(text(input.write.content)).map(([locale, html]) => [locale, sanitizeArticleHtml(html)]),
		),
		metaTitle: text(input.write.metaTitle),
		metaDescription: text(input.write.metaDescription),
		metaImageAssetId: input.write.metaImageAssetId,
		// No share picture means no version either; a picture keeps the version chosen for it.
		metaImageVersionId: input.write.metaImageAssetId ? (input.write.metaImageVersionId ?? null) : null,
		version: (input.current?.version ?? 0) + 1,
		updatedAt: input.now.toISOString(),
		updatedBy: input.actor,
	};
}

/** Where a legal page is drawn from: the shop language, else English. */
export const legalPageText = (map: Readonly<Record<string, string>>, locale: string): string =>
	map[locale] || map['en'] || '';
