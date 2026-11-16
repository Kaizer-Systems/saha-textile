import { LEGAL_PAGE_SLUGS, type LegalPage } from '@saha-textile/contracts';

import { MongoLegalPageRepository } from '../repositories/legal-page.repository';
import { LEGAL_PAGES_AS_SHIPPED } from './legal-pages-as-shipped';

/**
 * Migration 0003 (Legal Pages brief): today's four pages, exactly as the shop showed them, written once into
 * `legalPages`. A page already in the database is never overwritten. Says how many pages it wrote.
 */
export async function seedLegalPages(now = new Date()): Promise<string> {
	const pages = new MongoLegalPageRepository();
	let written = 0;
	for (const slug of LEGAL_PAGE_SLUGS) {
		const shipped = LEGAL_PAGES_AS_SHIPPED[slug];
		if (!shipped) continue;
		const page: LegalPage = {
			slug,
			title: { ...shipped.title },
			content: { ...shipped.content },
			metaTitle: {},
			metaDescription: {},
			metaImageAssetId: null,
			version: 1,
			updatedAt: now.toISOString(),
			updatedBy: null,
		};
		if (await pages.createIfMissing(page)) written += 1;
	}
	return `wrote ${written} legal page${written === 1 ? '' : 's'}`;
}
