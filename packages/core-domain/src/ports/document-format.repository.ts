import type { DocumentFormat, DocumentKind } from '@saha-textile/contracts';

/**
 * Settings › Document formats (`documentFormats`; bundle builder brief F, approved 2026-11-22). Exactly one active
 * format per document: `switchOn` turns the chosen one on and the document's other formats off in one transaction.
 */
export interface DocumentFormatRepository {
	list(): Promise<DocumentFormat[]>;
	findById(id: string): Promise<DocumentFormat | null>;
	/** The format a document prints with now; null only before the release step has seeded ours. */
	findActive(doc: DocumentKind): Promise<DocumentFormat | null>;
	create(format: DocumentFormat): Promise<DocumentFormat>;
	/** Saves when the stored version is still `expectedVersion`; null when someone saved in between. */
	update(format: DocumentFormat, expectedVersion: number): Promise<DocumentFormat | null>;
	switchOn(id: string, by: string): Promise<{ on: DocumentFormat; off: DocumentFormat | null } | null>;
}
