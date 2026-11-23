import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { EDocCall, EDocSettings, EDocument } from '@saha-textile/contracts';
import {
	type EDocKeyStore,
	type EDocListFilter,
	type EDocRepository,
	type EDocSecrets,
	StaleVersionError,
} from '@saha-textile/core-domain';

import { EDocCallModel, EDocKeysModel, EDocSettingsModel, EDocumentModel } from '../models/edocs.model';
import type { AggregateDoc } from '../models/purchasing.model';

const strip = (doc: AggregateDoc): Record<string, unknown> => {
	const { _id, ...rest } = doc;
	void _id;
	return rest;
};
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Settings, the IRN / e-way bill records and the activity log (accounts brief addendum 2). */
export class MongoEDocRepository implements EDocRepository {
	async getSettings(gstin: string): Promise<EDocSettings | null> {
		const doc = await EDocSettingsModel.findById(gstin).lean<AggregateDoc>().exec();
		return doc ? EDocSettings.parse({ ...strip(doc), gstin: doc._id }) : null;
	}

	async saveSettings(settings: EDocSettings, expectedUpdatedAt: string | null): Promise<EDocSettings> {
		const { gstin, ...rest } = settings;
		try {
			const result = await EDocSettingsModel.updateOne(
				{ _id: gstin, updatedAt: expectedUpdatedAt },
				{ $set: rest },
				{ upsert: expectedUpdatedAt === null },
			).exec();
			if (result.matchedCount === 1 || result.upsertedCount === 1) return settings;
		} catch (error) {
			if ((error as { code?: number }).code !== 11000) throw error;
		}
		const now = await this.getSettings(gstin);
		throw new StaleVersionError('edoc_settings', gstin, {
			version: 0,
			updatedAt: now?.updatedAt ?? '',
			updatedBy: now?.updatedBy ?? null,
		});
	}

	async findActive(kind: 'eInvoice' | 'eWayBill', documentId: string): Promise<EDocument | null> {
		const doc = await EDocumentModel.findOne({ kind, documentId, status: 'active' }).lean<AggregateDoc>().exec();
		return doc ? EDocument.parse({ ...strip(doc), id: doc._id }) : null;
	}

	async findById(id: string): Promise<EDocument | null> {
		const doc = await EDocumentModel.findById(id).lean<AggregateDoc>().exec();
		return doc ? EDocument.parse({ ...strip(doc), id: doc._id }) : null;
	}

	async insert(doc: EDocument): Promise<void> {
		const { id, ...rest } = doc;
		await EDocumentModel.create({ _id: id, ...rest });
	}

	async replace(doc: EDocument): Promise<void> {
		const { id, ...rest } = doc;
		await EDocumentModel.replaceOne({ _id: id }, rest).exec();
	}

	async list(filter: EDocListFilter): Promise<{ rows: EDocument[]; total: number }> {
		const query: Record<string, unknown> = { kind: filter.kind };
		if (filter.gstin) query['gstin'] = filter.gstin;
		if (filter.status) query['status'] = filter.status;
		if (filter.from || filter.to)
			query['documentDate'] = {
				...(filter.from ? { $gte: filter.from } : {}),
				...(filter.to ? { $lte: filter.to } : {}),
			};
		if (filter.q) {
			const re = new RegExp(escapeRegex(filter.q.trim()), 'i');
			query['$or'] = [{ documentNumber: re }, { irn: re }, { ewbNumber: re }, { ackNo: re }];
		}
		const [docs, total] = await Promise.all([
			EDocumentModel.find(query)
				.sort({ documentDate: -1, _id: -1 })
				.skip((filter.page - 1) * filter.pageSize)
				.limit(filter.pageSize)
				.lean<AggregateDoc[]>()
				.exec(),
			EDocumentModel.countDocuments(query).exec(),
		]);
		return { rows: docs.map((doc) => EDocument.parse({ ...strip(doc), id: doc._id })), total };
	}

	async logCall(call: EDocCall): Promise<void> {
		const { id, ...rest } = call;
		await EDocCallModel.create({ _id: id, ...rest });
	}

	async listCalls(
		gstin: string | null,
		page: number,
		pageSize: number,
	): Promise<{ rows: EDocCall[]; total: number }> {
		const query = gstin ? { gstin } : {};
		const [docs, total] = await Promise.all([
			EDocCallModel.find(query)
				.sort({ at: -1 })
				.skip((page - 1) * pageSize)
				.limit(pageSize)
				.lean<AggregateDoc[]>()
				.exec(),
			EDocCallModel.countDocuments(query).exec(),
		]);
		return { rows: docs.map((doc) => EDocCall.parse({ ...strip(doc), id: doc._id })), total };
	}
}

const ALGORITHM = 'aes-256-gcm';
type Sealed = { iv: string; tag: string; data: string };

function seal(key: Buffer, text: string): Sealed {
	const iv = randomBytes(12);
	const cipher = createCipheriv(ALGORITHM, key, iv);
	const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
	return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function open(key: Buffer, sealed: Sealed): string | null {
	try {
		const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.iv, 'base64'));
		decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
		return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
	} catch {
		return null;
	}
}

/**
 * The automatic paths' secrets, AES-256-GCM with `EDOC_KEYS_KEY` (32 bytes, server settings only), the
 * mailbox pattern: a fresh IV per write, the tag checked on read, and a row that won't open reads as "no keys",
 * so the path shows as needing its keys again instead of failing.
 */
export class MongoEDocKeyStore implements EDocKeyStore {
	readonly available = true;
	private readonly key: Buffer;
	private readonly previousKey: Buffer | null;

	/**
	 * `previousKey` (EDOC_KEYS_KEY_PREVIOUS) serves a planned key change, as the mailbox key does: keys that open
	 * only with it are sealed again under the new key when read, so no path needs its keys entered again.
	 */
	constructor(key: Uint8Array, previousKey?: Uint8Array) {
		if (key.length !== 32) throw new Error('EDOC_KEYS_KEY must be 32 bytes');
		if (previousKey && previousKey.length !== 32) throw new Error('EDOC_KEYS_KEY_PREVIOUS must be 32 bytes');
		this.key = Buffer.from(key);
		this.previousKey = previousKey ? Buffer.from(previousKey) : null;
	}

	async put(gstin: string, path: string, secrets: EDocSecrets): Promise<void> {
		await EDocKeysModel.updateOne(
			{ _id: `${gstin}:${path}` },
			{ $set: { sealed: seal(this.key, JSON.stringify(secrets)) } },
			{ upsert: true },
		).exec();
	}

	async get(gstin: string, path: string): Promise<EDocSecrets | null> {
		const doc = await EDocKeysModel.findById(`${gstin}:${path}`).lean<AggregateDoc>().exec();
		const sealed = doc?.['sealed'] as Sealed | undefined;
		if (!sealed) return null;
		const current = open(this.key, sealed);
		if (current !== null) return JSON.parse(current) as EDocSecrets;
		const previous = this.previousKey ? open(this.previousKey, sealed) : null;
		if (previous === null) return null;
		const secrets = JSON.parse(previous) as EDocSecrets;
		await this.put(gstin, path, secrets);
		return secrets;
	}

	async remove(gstin: string, path: string): Promise<void> {
		await EDocKeysModel.deleteOne({ _id: `${gstin}:${path}` }).exec();
	}
}

/** Without EDOC_KEYS_KEY: nothing is stored; the screens say automatic paths need the server key first. */
export class UnavailableEDocKeyStore implements EDocKeyStore {
	readonly available = false;
	put(): Promise<void> {
		return Promise.reject(new Error('edoc_keys_key_missing'));
	}
	get(): Promise<EDocSecrets | null> {
		return Promise.resolve(null);
	}
	remove(): Promise<void> {
		return Promise.resolve();
	}
}
