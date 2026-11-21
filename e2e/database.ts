import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Connection } from 'mongoose';

type TestLogin = typeof import('../scripts/secrets/test-login.mjs');

/**
 * The test login is an ES module (it reads `import.meta`), and Playwright compiles the specs as
 * CommonJS, so a static import of it stopped every spec that uses this file from loading. A native
 * dynamic import at call time keeps it as it is for its other callers.
 */
const loadTestLogin = new Function('url', 'return import(url)') as (url: string) => Promise<TestLogin>;
const testLoginUrl = pathToFileURL(resolve(__dirname, '../scripts/secrets/test-login.mjs')).href;

const adapterPackage = resolve(__dirname, '../packages/adapters-db-mongo/package.json');
const mongoose = createRequire(adapterPackage)('mongoose') as typeof import('mongoose');

const DATABASE = 'saha_textile_e2e';

const envFile = resolve(__dirname, '../apps/api/.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

/**
 * Opens the throwaway browser-test database for one step. Tests never touch any other. It logs in
 * with this Mac's test login (scripts/secrets/test-login.mjs) when there is one.
 */
export async function withDatabase<T>(work: (connection: Connection) => Promise<T>): Promise<T> {
	const { testDatabaseUri } = await loadTestLogin(testLoginUrl);
	const uri = testDatabaseUri({
		host: process.env['MONGODB_HOST'],
		port: process.env['MONGODB_PORT'],
		replicaSet: process.env['MONGODB_REPLICA_SET'],
		database: DATABASE,
	});
	const connection = await mongoose.createConnection(uri).asPromise();
	try {
		return await work(connection);
	} finally {
		await connection.close();
	}
}

/**
 * Stand-in rows for the live banners on the home page: three hero slides and two promos. Their picture files do not
 * exist, so the home page draws them collapsed; the answer puts back exactly what was there before (the rows they
 * replaced, or nothing), so a later spec sees the home page a fresh test database has.
 */
export async function ensureHomeBanners(): Promise<() => Promise<void>> {
	const keptAssets = new Map<string, Record<string, unknown> | null>();
	const keptBlocks = new Map<string, Record<string, unknown> | null>();
	const slots = [
		['hero', 'main'],
		['hero', 'slide_2'],
		['hero', 'slide_3'],
		['promo_wide', 'item_1'],
		['promo_wide', 'item_2'],
	] as const;
	await withDatabase(async (db) => {
		for (const [position, slot] of slots) {
			const assetId = `med_e2e_${position}_${slot}`;
			const key = `home:-:${position}:${slot}`;
			keptAssets.set(assetId, await db.collection('mediaAssets').findOne({ _id: assetId as never }));
			keptBlocks.set(key, await db.collection('contentBlocks').findOne({ key }));
			await db.collection('mediaAssets').updateOne(
				{ _id: assetId as never },
				{
					$set: {
						kind: 'image',
						purpose: 'banner',
						slug: `e2e-${position}-${slot}`,
						width: 2789,
						height: 825,
						derivatives: [
							{
								role: 'banner',
								storageKey: `media/${assetId}/banner-480w.webp`,
								width: 480,
								height: 142,
								byteSize: 2468,
								format: 'image/webp',
								roleVersion: 1,
							},
						],
						processing: { state: 'ready', attempts: 1, error: null },
						status: 'live',
						deletedAt: null,
						text: { alt: {}, title: {}, caption: {} },
					},
				},
				{ upsert: true },
			);
			// Two upserts that both find no row both insert, and the second fails on the shared id; tried again, it
			// finds the first one's row and updates it.
			const upsertBlock = () =>
				db.collection('contentBlocks').updateOne(
					{ key },
					{
						$set: {
							ownerType: 'home',
							ownerId: null,
							position,
							slot,
							images: { desktop: assetId, tablet: null, phone: null },
							containsText: false,
							localeImages: {},
							heading: {},
							subheading: {},
							ctaLabel: {},
							link: { href: '/collections', external: false },
							alt: { en: 'Saha Textile collection', bn: 'Collection Saha Textile' },
							status: 'active',
							startsAt: null,
							endsAt: null,
							assetIds: [assetId],
						},
						$setOnInsert: { _id: `cbk_e2e_${position}_${slot}` as never },
					},
					{ upsert: true },
				);
			try {
				await upsertBlock();
			} catch (error) {
				if ((error as { code?: unknown }).code !== 11000) throw error;
				await upsertBlock();
			}
		}
	});
	return () =>
		withDatabase(async (db) => {
			for (const [assetId, row] of keptAssets) {
				if (row) await db.collection('mediaAssets').replaceOne({ _id: assetId as never }, row);
				else await db.collection('mediaAssets').deleteOne({ _id: assetId as never });
			}
			for (const [key, row] of keptBlocks) {
				if (row) await db.collection('contentBlocks').replaceOne({ key }, row);
				else await db.collection('contentBlocks').deleteOne({ key });
			}
		});
}
