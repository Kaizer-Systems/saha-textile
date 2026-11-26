import 'dotenv/config';
import 'reflect-metadata';

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
	MongoContentBlockRepository,
	MongoMediaAssetRepository,
	MongoSiteSettingsRepository,
	connectMongo,
	disconnectMongo,
} from '@saha-textile/adapters-db-mongo';
import { BullMqMediaJobQueue } from '@saha-textile/adapters-queue-bullmq';
import { SpacesStorageAdapter } from '@saha-textile/adapters-storage-spaces';
import {
	BANNER_MAX_DISPLAY_WIDTH,
	type BannerPosition,
	ContentBlockInput,
	contentBlockKey,
} from '@saha-textile/contracts';
import sharp from 'sharp';

import { loadConfig } from './config/app-config';
import { ContentBlocksService } from './media/content-blocks.service';
import { LanguageStore } from './languages/language-store';
import { composeMongoMediaService } from './media/compose-media-service';

/**
 * LOCAL-ONLY: gives the home page its stand-in banners.
 *
 *   pnpm --filter @saha-textile/api seed:local-home-banners -- --i-am-local
 *
 * Each theme placeholder goes through the real pipeline, exactly as an admin upload would, then
 * becomes a live banner row, so replacing one later is an image swap on the Home banners screen.
 * Every slot of every hero layout is filled, so switching layout in admin works at once.
 *
 * Slots that already hold a banner are skipped: a run adds rows and never overwrites or deletes.
 * Built on the repositories directly, like `seed-local-catalog-photos`, and excluded from
 * `nest build`.
 */

const THEMES = resolve(__dirname, '../../storefront/public/assets/images/data/themes');
const SLUG_PREFIX = 'local-home-banner';
/** The carousel keeps one height, so its slides share the first slide's shape. */
const SLIDE_SIZE = { width: 2789, height: 825 };
const PLACEHOLDER_GREY = '#f8f8f8';

interface StandIn {
	position: BannerPosition;
	slot: string;
	file: string;
	slide?: true;
}

const STAND_INS: StandIn[] = [
	{ position: 'hero', slot: 'main', file: 'denver/1.jpg', slide: true },
	{ position: 'hero', slot: 'slide_2', file: 'denver/2.jpg', slide: true },
	{ position: 'hero', slot: 'slide_3', file: 'denver/3.jpg', slide: true },
	{ position: 'hero', slot: 'side', file: 'berlin/2.jpg' },
	{ position: 'hero', slot: 'side_top', file: 'paris/2.jpg' },
	{ position: 'hero', slot: 'side_bottom', file: 'paris/3.jpg' },
	{ position: 'hero', slot: 'left', file: 'tokyo/2.jpg' },
	{ position: 'hero', slot: 'right', file: 'paris/4.jpg' },
	{ position: 'promo_wide', slot: 'item_1', file: 'berlin/2.jpg' },
	{ position: 'promo_wide', slot: 'item_2', file: 'berlin/3.jpg' },
];

const args = process.argv.slice(2);
if (!args.includes('--i-am-local')) throw new Error('Pass --i-am-local: this writes to the dev bucket and database.');
if (process.env['NODE_ENV'] === 'production') throw new Error('Refused: NODE_ENV=production.');
const mongoHost = (process.env['MONGODB_HOST'] || '127.0.0.1').toLowerCase();
if (!['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(mongoHost))
	throw new Error(`Refused: MONGODB_HOST=${mongoHost} is not a loopback host.`);
const config = loadConfig();
if (!/_local$/.test(process.env['MONGODB_DB_NAME'] ?? ''))
	throw new Error('Refusing: MONGODB_DB_NAME must end in _local.');
const { key, secret, bucket, region, endpoint, cdnUrl } = config.spaces;
if (!key || !secret || !bucket) throw new Error('Spaces credentials are required');

const assets = new MongoMediaAssetRepository();
const blocks = new MongoContentBlockRepository();
const storage = new SpacesStorageAdapter({ key, secret, bucket, region, endpoint, cdnUrl });
const queue = new BullMqMediaJobQueue(config.redis);
// Local demo data is written in the languages this Mac starts with.
const languages = LanguageStore.fixed(config.locales);
const audit = { append: async <T>(entry: T) => entry };
const media = composeMongoMediaService({ storage, queue, audit: audit as never, languages });
const banners = new ContentBlocksService(blocks, assets, new MongoSiteSettingsRepository(), storage, languages);
const admin = { type: 'admin' as const, id: 'adm_local_banners' };

const artFor = async (standIn: StandIn): Promise<Buffer> => {
	const file = await readFile(resolve(THEMES, standIn.file));
	if (!standIn.slide) return file;
	return sharp(file)
		.resize({ ...SLIDE_SIZE, fit: 'contain', background: PLACEHOLDER_GREY })
		.jpeg({ quality: 90 })
		.toBuffer();
};

const upload = async (standIn: StandIn): Promise<string> => {
	const body = await artFor(standIn);
	const { width, height } = await sharp(body).metadata();
	if (!width || !height) throw new Error(`${standIn.file}: unreadable image`);
	const presigned = await media.presign(admin, {
		purpose: 'banner',
		contentType: 'image/jpeg',
		byteSize: body.byteLength,
		fileName: `${SLUG_PREFIX}-${standIn.position}-${standIn.slot}.jpg`,
		width,
		height,
		maxDisplayWidth: BANNER_MAX_DISPLAY_WIDTH[standIn.position],
	});
	const stored = await fetch(presigned.uploadUrl, {
		method: 'PUT',
		headers: presigned.headers,
		body: new Uint8Array(body),
	});
	if (!stored.ok) throw new Error(`${standIn.file}: upload refused (${stored.status})`);
	await media.finalize(admin, presigned.assetId);
	for (let attempt = 0; attempt < 180; attempt += 1) {
		const status = await media.status(admin, presigned.assetId);
		if (status.state === 'ready') return presigned.assetId;
		if (status.state === 'failed') throw new Error(`${standIn.file}: processing failed: ${status.error}`);
		await new Promise((settle) => setTimeout(settle, 1000));
	}
	throw new Error('worker did not finish (is `pnpm --filter @saha-textile/api worker:dev` running?)');
};

async function main(): Promise<void> {
	await connectMongo();
	try {
		for (const standIn of STAND_INS) {
			const where = { ownerType: 'home' as const, ownerId: null, ...standIn };
			const name = contentBlockKey(where);
			if (await blocks.findByKey(name)) {
				console.log(`${name}: already set, left alone`);
				continue;
			}
			const desktop = await upload(standIn);
			await banners.upsert(
				ContentBlockInput.parse({
					ownerType: 'home',
					ownerId: null,
					position: standIn.position,
					slot: standIn.slot,
					images: { desktop },
					alt: { en: 'Saha Textile collection', bn: 'সাহা টেক্সটাইলের কালেকশন' },
					link: { href: '/collections', external: false },
					status: 'active',
				}),
			);
			console.log(`${name}: ${standIn.file} → ${desktop}`);
		}
	} finally {
		await queue.close();
		await disconnectMongo();
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
