import type mongoose from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';

/**
 * Irreversible population split (`DEC-ACCOUNT-SEPARATION` Pass 5b / D5 / D10).
 *
 * Moves `role: staff|admin` rows from `customers` into `adminUsers`, drops each
 * population's irrelevant fields, rewrites operator ids to `adm_…` (and remaining
 * customer ids to `cus_…`), and rewrites foreign keys that pointed at those ids.
 *
 * ## Safety properties
 *
 * - **Idempotent.** A second run with no operators left in `customers` and a populated
 *   `adminUsers` reports `already-split` and writes nothing.
 * - **Refuses when target already holds data while source still has operators** —
 *   `conflict`. Never merges. Never `dropTarget`.
 * - **`--dry-run`** reports the plan without writes.
 *
 * Not run at boot. Invoke via `pnpm mongo:split-admin-users`.
 *
 * Uses untyped collection handles on purpose: identity ids are string prefixes (`cus_` /
 * `adm_` / legacy `user_`), not ObjectId, and the driver generics assume ObjectId.
 */

type LeanDoc = Record<string, unknown> & { _id: string };

/** Untyped collection surface for string-id identity documents. */
interface StringIdCollection {
	find(filter: Record<string, unknown>): { toArray(): Promise<LeanDoc[]> };
	findOne(filter: Record<string, unknown>): Promise<LeanDoc | null>;
	countDocuments(filter?: Record<string, unknown>): Promise<number>;
	insertMany(docs: LeanDoc[]): Promise<unknown>;
	insertOne(doc: LeanDoc): Promise<unknown>;
	deleteMany(filter: Record<string, unknown>): Promise<unknown>;
	deleteOne(filter: Record<string, unknown>): Promise<unknown>;
	updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<unknown>;
	updateMany(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<unknown>;
}

const OPERATOR_ROLES = new Set(['staff', 'admin']);

const ADMIN_KEEP = new Set([
	'_id',
	'email',
	'emailVerified',
	'username',
	'displayName',
	'role',
	'status',
	'passwordHash',
	'pinHash',
	'preferredLoginMethod',
	'permissions',
	'tokenVersion',
	'permissionsVersion',
	'failedLoginAttempts',
	'failedPinAttempts',
	'pinLockedUntil',
	'pinRevalidationRequiredAt',
	'lastLoginAt',
	'adminProfile',
	'createdAt',
	'updatedAt',
	'__v',
]);

const CUSTOMER_DROP = [
	'username',
	'role',
	'pinHash',
	'preferredLoginMethod',
	'permissions',
	'permissionsVersion',
	'failedPinAttempts',
	'pinLockedUntil',
	'pinRevalidationRequiredAt',
	'adminProfile',
] as const;

/** Collections + fields that may hold a rewritten identity id. */
const FK_UPDATES: ReadonlyArray<{ collection: string; fields: readonly string[] }> = [
	{ collection: COLLECTION_NAMES.AuthSession, fields: ['userId'] },
	{
		collection: COLLECTION_NAMES.AdminUserRoleAssignment,
		fields: ['userId', 'assignedByUserId', 'revokedByUserId'],
	},
	{ collection: COLLECTION_NAMES.AdminInvite, fields: ['invitedByUserId'] },
	{ collection: COLLECTION_NAMES.AuditLog, fields: ['actorUserId', 'targetUserId'] },
	{ collection: COLLECTION_NAMES.Cart, fields: ['userId'] },
	{ collection: COLLECTION_NAMES.Order, fields: ['userId'] },
	{ collection: COLLECTION_NAMES.ConsentEvent, fields: ['userId'] },
	{ collection: COLLECTION_NAMES.PasswordResetToken, fields: ['userId'] },
	{ collection: COLLECTION_NAMES.EmailVerificationToken, fields: ['userId'] },
	{ collection: COLLECTION_NAMES.OtpChallenge, fields: ['userId'] },
	{ collection: COLLECTION_NAMES.MessageOutbox, fields: ['userId'] },
	{ collection: COLLECTION_NAMES.ProductQuestion, fields: ['userId', 'answeredByUserId'] },
	{ collection: COLLECTION_NAMES.Review, fields: ['userId', 'moderatedByUserId'] },
	{ collection: COLLECTION_NAMES.InventoryLedger, fields: ['actorUserId'] },
];

export type SplitOutcome = 'split' | 'already-split' | 'absent' | 'conflict';

export interface SplitReport {
	dryRun: boolean;
	outcome: SplitOutcome;
	operatorsMoved: number;
	customersRewritten: number;
	foreignKeysUpdated: number;
	idMap: Record<string, string>;
	message: string;
}

export interface SplitAdminUsersOptions {
	dryRun?: boolean;
	sourceCollection?: string;
	targetCollection?: string;
}

export function toAdminUserId(oldId: string): string {
	if (oldId.startsWith('adm_')) return oldId;
	if (oldId.startsWith('user_')) return `adm_${oldId.slice('user_'.length)}`;
	if (oldId.startsWith('cus_')) return `adm_${oldId.slice('cus_'.length)}`;
	return `adm_${oldId}`;
}

export function toCustomerId(oldId: string): string {
	if (oldId.startsWith('cus_')) return oldId;
	if (oldId.startsWith('user_')) return `cus_${oldId.slice('user_'.length)}`;
	return `cus_${oldId}`;
}

function pickAdminDoc(doc: LeanDoc, newId: string): LeanDoc {
	const next: LeanDoc = { _id: newId };
	for (const [key, value] of Object.entries(doc)) {
		if (key === '_id') continue;
		if (ADMIN_KEEP.has(key)) next[key] = value;
	}
	if (next.role !== 'staff' && next.role !== 'admin') {
		throw new Error(`refusing to move non-operator role=${String(next.role)}`);
	}
	return next;
}

function asStringIdCollection(db: NonNullable<mongoose.Connection['db']>, name: string): StringIdCollection {
	return db.collection(name) as unknown as StringIdCollection;
}

async function collectionExists(db: NonNullable<mongoose.Connection['db']>, name: string): Promise<boolean> {
	const names = await db.listCollections({ name }, { nameOnly: true }).toArray();
	return names.length > 0;
}

async function rewriteForeignKeys(
	db: NonNullable<mongoose.Connection['db']>,
	idMap: Map<string, string>,
	dryRun: boolean,
): Promise<number> {
	if (idMap.size === 0) return 0;
	let updated = 0;
	const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((info) => info.name));

	for (const { collection, fields } of FK_UPDATES) {
		if (!existing.has(collection)) continue;
		const coll = asStringIdCollection(db, collection);
		for (const field of fields) {
			for (const [from, to] of idMap) {
				if (from === to) continue;
				const filter = { [field]: from };
				const count = await coll.countDocuments(filter);
				if (count === 0) continue;
				updated += count;
				if (!dryRun) {
					await coll.updateMany(filter, { $set: { [field]: to } });
				}
			}
		}
	}
	return updated;
}

export async function splitAdminUsers(
	connection: mongoose.Connection,
	options: SplitAdminUsersOptions = {},
): Promise<SplitReport> {
	const dryRun = options.dryRun ?? false;
	const sourceName = options.sourceCollection ?? COLLECTION_NAMES.Customer;
	const targetName = options.targetCollection ?? COLLECTION_NAMES.AdminUser;

	const db = connection.db;
	if (!db) throw new Error('splitAdminUsers requires an established connection');

	const hasSource = await collectionExists(db, sourceName);
	if (!hasSource) {
		return {
			dryRun,
			outcome: 'absent',
			operatorsMoved: 0,
			customersRewritten: 0,
			foreignKeysUpdated: 0,
			idMap: {},
			message: `source collection ${sourceName} is absent`,
		};
	}

	const source = asStringIdCollection(db, sourceName);
	const operators = await source.find({ role: { $in: [...OPERATOR_ROLES] } }).toArray();
	const targetExists = await collectionExists(db, targetName);
	const target = asStringIdCollection(db, targetName);
	const targetCount = targetExists ? await target.countDocuments({}) : 0;

	if (operators.length === 0 && targetCount > 0) {
		return {
			dryRun,
			outcome: 'already-split',
			operatorsMoved: 0,
			customersRewritten: 0,
			foreignKeysUpdated: 0,
			idMap: {},
			message: 'no operators remain in customers; adminUsers already populated',
		};
	}

	if (operators.length === 0 && targetCount === 0) {
		const legacyCustomers = await source.find({ _id: { $regex: '^user_' } }).toArray();
		if (legacyCustomers.length === 0) {
			return {
				dryRun,
				outcome: 'absent',
				operatorsMoved: 0,
				customersRewritten: 0,
				foreignKeysUpdated: 0,
				idMap: {},
				message: 'nothing to split or rewrite',
			};
		}
	}

	if (operators.length > 0 && targetCount > 0) {
		return {
			dryRun,
			outcome: 'conflict',
			operatorsMoved: 0,
			customersRewritten: 0,
			foreignKeysUpdated: 0,
			idMap: {},
			message: 'adminUsers already holds data while customers still has staff|admin rows — refuse to merge',
		};
	}

	const idMap = new Map<string, string>();
	const adminDocs: LeanDoc[] = [];
	for (const doc of operators) {
		const oldId = String(doc._id);
		const newId = toAdminUserId(oldId);
		idMap.set(oldId, newId);
		adminDocs.push(pickAdminDoc(doc, newId));
	}

	const remaining = await source.find({ role: { $nin: [...OPERATOR_ROLES] } }).toArray();
	const customerRewrites: Array<{ oldId: string; newId: string; unset: Record<string, ''> }> = [];
	for (const doc of remaining) {
		const oldId = String(doc._id);
		const newId = toCustomerId(oldId);
		if (oldId !== newId) idMap.set(oldId, newId);
		const unset: Record<string, ''> = {};
		for (const field of CUSTOMER_DROP) {
			if (field in doc) unset[field] = '';
		}
		customerRewrites.push({ oldId, newId, unset });
	}

	const foreignKeysUpdated = await rewriteForeignKeys(db, idMap, dryRun);

	if (!dryRun) {
		if (adminDocs.length > 0) {
			await target.insertMany(adminDocs);
			await source.deleteMany({ _id: { $in: operators.map((row) => row._id) } });
		}

		for (const rewrite of customerRewrites) {
			if (rewrite.oldId === rewrite.newId) {
				if (Object.keys(rewrite.unset).length > 0) {
					await source.updateOne({ _id: rewrite.oldId }, { $unset: rewrite.unset });
				}
				continue;
			}
			const existing = await source.findOne({ _id: rewrite.oldId });
			if (!existing) continue;
			const next: LeanDoc = { ...existing, _id: rewrite.newId };
			for (const field of CUSTOMER_DROP) {
				delete next[field];
			}
			await source.insertOne(next);
			await source.deleteOne({ _id: rewrite.oldId });
		}
	}

	return {
		dryRun,
		outcome: 'split',
		operatorsMoved: adminDocs.length,
		customersRewritten: customerRewrites.filter(
			(row) => row.oldId !== row.newId || Object.keys(row.unset).length > 0,
		).length,
		foreignKeysUpdated,
		idMap: Object.fromEntries(idMap),
		message: dryRun
			? `would move ${adminDocs.length} operators and rewrite ${customerRewrites.length} customer rows`
			: `moved ${adminDocs.length} operators and rewritten ${customerRewrites.length} customer rows`,
	};
}
