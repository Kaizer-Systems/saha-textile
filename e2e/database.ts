import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import type { Connection } from 'mongoose';

import { testDatabaseUri } from '../scripts/secrets/test-login.mjs';

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

/** Stand-in rows for the live banners on the home page: three hero slides and two promos. */
export async function ensureHomeBanners(): Promise<void> {
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
			await db.collection('contentBlocks').updateOne(
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
		}
	});
}
