import { randomUUID } from 'node:crypto';

import type { SeoRedirect } from '@saha-textile/contracts';
import { collapseRedirectTarget, type SeoRedirectRepository, type TransactionContext } from '@saha-textile/core-domain';

import { SeoRedirectModel, type SeoRedirectDoc } from '../models/merchandising.model';
import { sessionFrom } from '../transaction-manager';

const iso = (value?: Date): string | undefined => (value ? new Date(value).toISOString() : undefined);

function toRow(doc: SeoRedirectDoc): SeoRedirect {
	return {
		id: doc._id,
		sourcePath: doc.sourcePath,
		statusCode: doc.statusCode,
		targetPath: doc.targetPath,
		reason: doc.reason as SeoRedirect['reason'],
		entityType: doc.entityType,
		entityId: doc.entityId,
		createdAt: iso(doc.createdAt),
		updatedAt: iso(doc.updatedAt),
	};
}

export class MongoSeoRedirectRepository implements SeoRedirectRepository {
	async list(): Promise<SeoRedirect[]> {
		const docs = await SeoRedirectModel.find().lean<SeoRedirectDoc[]>().exec();
		return docs.map(toRow);
	}

	async findBySource(sourcePath: string): Promise<SeoRedirect | null> {
		const doc = await SeoRedirectModel.findOne({ sourcePath }).lean<SeoRedirectDoc>().exec();
		return doc ? toRow(doc) : null;
	}

	/**
	 * Saves one row after collapsing any chain. The other rows are the chain;
	 * this source is excluded so a rename of an existing row cannot point at itself.
	 */
	async save(row: SeoRedirect, context?: TransactionContext): Promise<SeoRedirect> {
		const others = (await this.list()).filter((existing) => existing.sourcePath !== row.sourcePath);
		const collapsed = collapseRedirectTarget(row.sourcePath, row.targetPath, row.statusCode, others);
		if ('error' in collapsed) throw new Error('redirect loop');
		const id = row.id || randomUUID();
		const doc = await SeoRedirectModel.findByIdAndUpdate(
			id,
			{
				$set: {
					sourcePath: row.sourcePath,
					statusCode: collapsed.statusCode,
					targetPath: collapsed.targetPath,
					reason: row.reason,
					entityType: row.entityType,
					entityId: row.entityId,
				},
			},
			{ upsert: true, returnDocument: 'after', session: sessionFrom(context) ?? undefined },
		)
			.lean<SeoRedirectDoc>()
			.exec();
		return toRow(doc as SeoRedirectDoc);
	}

	async remove(sourcePath: string, context?: TransactionContext): Promise<void> {
		await SeoRedirectModel.deleteOne({ sourcePath }, { session: sessionFrom(context) ?? undefined }).exec();
	}
}
