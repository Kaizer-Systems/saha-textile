import type { LegalPage, LegalPageSlug } from '@saha-textile/contracts';

/**
 * The four legal pages (`legalPages`) and every earlier version of them (`legalPageRevisions`, choice 3: kept in the
 * database with no screen, so the terms on any day can be looked up).
 */
export interface LegalPageRepository {
	list(): Promise<LegalPage[]>;
	find(slug: LegalPageSlug): Promise<LegalPage | null>;
	/** Writes the page and keeps the version it replaces; one transaction. */
	save(page: LegalPage, replaced: LegalPage | null): Promise<void>;
	/** The one-time release step: writes a page only where none is stored yet. Answers whether it wrote. */
	createIfMissing(page: LegalPage): Promise<boolean>;
}
