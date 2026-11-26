import { DocumentFormat } from '@saha-textile/contracts';
import { seedDocumentFormats } from '@saha-textile/core-domain';

import { DocumentFormatModel } from '../models/index';

/**
 * Migration 0016 (bundle builder brief F, approved 2026-11-22): our formats, so every document prints from day one:
 * "Saha Textile standard" for all 17 documents (switched on) and the tax invoice's "Compact" and "Counter receipt"
 * (switched off). A format already stored under the same id is never overwritten, and a document that already has
 * an active format keeps it.
 */
export async function seedDocumentFormatsStep(): Promise<string> {
	let written = 0;
	for (const seed of seedDocumentFormats()) {
		const format = DocumentFormat.parse(seed);
		const hasActive = format.active ? await DocumentFormatModel.exists({ doc: format.doc, active: true }) : null;
		const { id, updatedAt: _u, ...rest } = format;
		const result = await DocumentFormatModel.updateOne(
			{ _id: id },
			{ $setOnInsert: { ...rest, active: format.active && !hasActive } },
			{ upsert: true },
		).exec();
		if (result.upsertedCount > 0) written += 1;
	}
	return `wrote ${written} document format${written === 1 ? '' : 's'}`;
}
