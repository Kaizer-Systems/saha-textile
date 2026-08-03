import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { COLLECTION_NAMES, LEGACY_COLLECTION_NAMES, NON_GRAPH_COLLECTIONS } from '../src/collection-names';
import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo, getMongoose } from '../src/connection';
import { alignCollectionNames } from '../src/migrations/align-collection-names';
import * as models from '../src/models/index';

/**
 * The physical collection name is an interface, not an implementation detail.
 *
 * Compass, the MCP MongoDB server, migrations, backups and the ratified Schema Nebula
 * graph all address collections by name. Mongoose will happily invent one from the model
 * name if `collection` is omitted, which is exactly how `authSessions` became
 * `authsessions` and `messageOutbox` became `messageoutboxes`.
 *
 * Two of these suites need no database; the migration suite needs the real replica set:
 *   MONGODB_PORT=27018 RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
function hasMongoEnv(): boolean {
	if (process.env.RUN_DB_IT !== '1') return false;
	try {
		buildMongoConfig();
		return true;
	} catch {
		return false;
	}
}

/** The shape this suite needs from a Mongoose model — nothing more. */
interface NamedModel {
	modelName: string;
	collection: { collectionName: string };
}

function isNamedModel(value: unknown): value is NamedModel {
	return typeof value === 'function' && 'modelName' in value && 'collection' in value;
}

/** Every exported Mongoose model, discovered rather than listed, so a new model cannot skip the check. */
const exportedModels: NamedModel[] = Object.values(models as Record<string, unknown>).filter(isNamedModel);

/**
 * `import.meta` is illegal in this package's CommonJS output, so the repository root is
 * derived from the working directory instead — and asserted, because a wrong cwd would
 * otherwise turn a real mismatch into a confusing file-not-found.
 */
function repositoryRoot(): string {
	const cwd = process.cwd();
	const marker = `${sep}packages${sep}adapters-db-mongo`;
	if (cwd.endsWith(marker)) return resolve(cwd, '../..');
	if (existsSync(resolve(cwd, 'packages/adapters-db-mongo/package.json'))) return cwd;
	throw new Error(`Cannot locate the repository root from cwd: ${cwd}`);
}

describe('physical collection names', () => {
	it('exports one model per declared name and no undeclared model', () => {
		const modelNames = exportedModels.map((model) => model.modelName).sort();
		expect(modelNames).toEqual(Object.keys(COLLECTION_NAMES).sort());
	});

	it('resolves every model to its ratified physical name', () => {
		// The assertion that would have caught the original defect: Mongoose's default
		// would give `authsessions`, `messageoutboxes`, `inventoryledgers`, and so on.
		for (const model of exportedModels) {
			const expected = COLLECTION_NAMES[model.modelName as keyof typeof COLLECTION_NAMES];
			expect(`${model.modelName} -> ${model.collection.collectionName}`).toBe(
				`${model.modelName} -> ${expected}`,
			);
		}
	});

	it('keeps every graph-backed name inside the ratified 64-node Schema Nebula graph', () => {
		// Reads the governed dataset rather than a copied list, so a rename on either side
		// has to be reconciled instead of quietly diverging.
		const nebulaPath = resolve(repositoryRoot(), 'docs/_data/instruments/schema-nebula.json');
		const nebula = JSON.parse(readFileSync(nebulaPath, 'utf8')) as { collections: Array<{ id: string }> };
		const nodeIds = new Set(nebula.collections.map((node) => node.id));
		expect(nodeIds.size).toBe(64);

		const graphBacked = Object.values(COLLECTION_NAMES).filter((name) => !NON_GRAPH_COLLECTIONS.includes(name));
		const missing = graphBacked.filter((name) => !nodeIds.has(name));
		expect(missing).toEqual([]);
	});

	it('never uses a Mongoose default name as a target', () => {
		// A target that is also a legacy key would make the migration a no-op loop.
		for (const [legacy, target] of Object.entries(LEGACY_COLLECTION_NAMES)) {
			expect(legacy).not.toBe(target);
			expect(Object.values(COLLECTION_NAMES)).toContain(target);
		}
	});
});

describe.runIf(hasMongoEnv())('collection-name alignment migration (rs0)', () => {
	beforeAll(async () => {
		await connectMongo();
	});

	afterAll(async () => {
		await disconnectMongo();
	});

	const legacyProbe = 'zz_legacy_probe_collection';
	const targetProbe = 'zzLegacyProbeCollection';

	async function dropProbes(): Promise<void> {
		const db = getMongoose().connection.db;
		if (!db) throw new Error('no connection');
		const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((info) => info.name));
		for (const name of [legacyProbe, targetProbe]) {
			if (names.has(name)) await db.dropCollection(name);
		}
	}

	it('moves documents and is idempotent on a second run', async () => {
		const db = getMongoose().connection.db;
		if (!db) throw new Error('no connection');
		await dropProbes();

		await db.collection(legacyProbe).insertOne({ _id: 'probe-1' as unknown as never, marker: 'kept' });

		const pairs = { [legacyProbe]: targetProbe };
		const first = await alignCollectionNames(getMongoose().connection, { pairs });
		expect(first.entries[0]?.outcome).toBe('renamed');
		expect(first.entries[0]?.documents).toBe(1);

		// The document travelled — a rename that lost data would still report "renamed".
		expect(await db.collection(targetProbe).countDocuments()).toBe(1);
		expect(await db.collection(targetProbe).findOne({ _id: 'probe-1' as unknown as never })).toMatchObject({
			marker: 'kept',
		});

		const second = await alignCollectionNames(getMongoose().connection, { pairs });
		expect(second.entries[0]?.outcome).toBe('already-aligned');
		expect(second.renamed).toBe(0);

		await dropProbes();
	});

	it('refuses to merge when both names hold data', async () => {
		const db = getMongoose().connection.db;
		if (!db) throw new Error('no connection');
		await dropProbes();

		await db.collection(legacyProbe).insertOne({ _id: 'legacy' as unknown as never });
		await db.collection(targetProbe).insertOne({ _id: 'target' as unknown as never });

		const report = await alignCollectionNames(getMongoose().connection, { pairs: { [legacyProbe]: targetProbe } });
		expect(report.conflicts).toBe(1);
		expect(report.entries[0]?.outcome).toBe('conflict');

		// Neither side was touched: a silent merge could destroy retained audit evidence.
		expect(await db.collection(legacyProbe).countDocuments()).toBe(1);
		expect(await db.collection(targetProbe).countDocuments()).toBe(1);

		await dropProbes();
	});

	it('reports a dry run without renaming anything', async () => {
		const db = getMongoose().connection.db;
		if (!db) throw new Error('no connection');
		await dropProbes();
		await db.collection(legacyProbe).insertOne({ _id: 'probe-dry' as unknown as never });

		const report = await alignCollectionNames(getMongoose().connection, {
			pairs: { [legacyProbe]: targetProbe },
			dryRun: true,
		});
		expect(report.dryRun).toBe(true);
		expect(report.entries[0]?.outcome).toBe('renamed');

		const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((info) => info.name));
		expect(names.has(legacyProbe)).toBe(true);
		expect(names.has(targetProbe)).toBe(false);

		await dropProbes();
	});

	it('leaves no Mongoose-default auth collection behind in the live database', async () => {
		const db = getMongoose().connection.db;
		if (!db) throw new Error('no connection');
		const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((info) => info.name));
		const stragglers = Object.keys(LEGACY_COLLECTION_NAMES).filter((legacy) => names.has(legacy));
		expect(stragglers).toEqual([]);
	});
});
