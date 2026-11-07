import { randomUUID } from 'node:crypto';

import { buildMongoConfig } from '../src/config';

/** True when `RUN_DB_IT=1` and the Mongo env parses, the gate every integration suite shares. */
export function hasMongoEnv(): boolean {
	if (process.env.RUN_DB_IT !== '1') return false;
	try {
		buildMongoConfig();
		return true;
	} catch {
		return false;
	}
}

/** A per-file prefix, so suites running side by side never share a row. */
export const runPrefix = (name: string): string => `repo_${name}_${randomUUID().slice(0, 8)}_`;

/** Writes straight to the collection, so a row can lack what the schema would add. */
export const insertRaw = async (
	model: { collection: { insertOne: (doc: never) => Promise<unknown> } },
	doc: Record<string, unknown>,
): Promise<void> => {
	await model.collection.insertOne(doc as never);
};
