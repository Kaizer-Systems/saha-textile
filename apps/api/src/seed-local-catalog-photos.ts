import 'dotenv/config';
import 'reflect-metadata';

import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';

import {
	MongoMediaAssetRepository,
	MongoMediaRoleRepository,
	connectMongo,
	disconnectMongo,
} from '@saha-textile/adapters-db-mongo';
import { BullMqMediaJobQueue } from '@saha-textile/adapters-queue-bullmq';
import { SpacesStorageAdapter } from '@saha-textile/adapters-storage-spaces';
import type { ResolvedImage } from '@saha-textile/contracts';
import { purgeAsset, resolveImage } from '@saha-textile/core-domain';
import { format, resolveConfig } from 'prettier';
import sharp from 'sharp';

import { loadConfig } from './config/app-config';
import { MediaService } from './media/media.service';

/**
 * LOCAL-ONLY: dresses the storefront's demo catalogue in real product photos.
 *
 *   pnpm --filter @saha-textile/api seed:local-catalog-photos -- --i-am-local a.jpg b.jpg c.jpg
 *   pnpm --filter @saha-textile/api seed:local-catalog-photos -- --i-am-local --assets=med_…,med_…
 *   pnpm --filter @saha-textile/api seed:local-catalog-photos -- --i-am-local --clean
 *
 * ## Why this exists
 *
 * Until the catalog chunk serves products from Mongo, the storefront reads the vendor demo JSON
 * under `apps/storefront/public/assets/data/`, where every product shows the same square
 * placeholder. That hides exactly what the media decisions are about: 3:4 cards, the gallery's
 * srcset and zoom, and how every smaller product slot (cart, wishlist, compare, orders) copes
 * with a portrait photo.
 *
 * ## What it does
 *
 * Each photo goes through the real pipeline — presign, upload of the private original, finalize,
 * the worker's derivatives in the dev bucket — exactly as an admin upload would. The demo JSON
 * then points every product image slot at the results: `original_url` becomes the 400 px card
 * derivative (the 300 px `thumb` in cart, order, refund and wishlist rows), and in `product.json`
 * `image` carries a `ResolvedImage` cut to the roles that slot renders (card for the thumbnail,
 * gallery and zoom for gallery images), so cards and the gallery get their srcset, intrinsic size
 * and zoom derivative. `--assets=` re-dresses the data
 * from photos already uploaded. A product keeps the same photo in every file (its
 * id picks it), so a cart line matches its card. Photos themselves never enter the repository;
 * only their CDN URLs do. `--clean` purges the assets and restores the placeholder.
 *
 * Takes JPEG or PNG (what the upload policy accepts): on macOS, `sips -s format jpeg photo.heic --out photo.jpg` converts
 * an iPhone/Android HEIC first. Built on the repositories directly, like `reset-local-customer`,
 * and excluded from `nest build`.
 */

const SLUG_PREFIX = 'local-catalog-photo';
const PLACEHOLDER_URL = 'assets/images/data/product.png';
const DATA_DIR = resolve(__dirname, '../../storefront/public/assets/data');
/**
 * What each file's slots show. Cards and the PDP gallery read `product.json`, so only it carries
 * the srcset-ready `image`; compare shows a card-sized photo and the rest are thumbnail rows.
 */
type SlotKind = 'card+srcset' | 'card' | 'thumb';
const DATA_FILES: Record<string, SlotKind> = {
	'product.json': 'card+srcset',
	'compare.json': 'card',
	'cart.json': 'thumb',
	'order.json': 'thumb',
	'refund.json': 'thumb',
	'wishlist.json': 'thumb',
};
/** The roles each slot renders: a card shows the thumbnail, the PDP gallery its gallery images. */
const CARRIED_ROLES: Record<string, string[]> = {
	product_thumbnail: ['card'],
	product_galleries: ['gallery', 'zoom'],
	variation_image: ['gallery', 'zoom'],
};
const PRODUCT_IMAGE_KEYS = new Set(['product_thumbnail', 'product_galleries', 'variation_image']);
const CONTENT_TYPES: Record<string, 'image/jpeg' | 'image/png'> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
};

const args = process.argv.slice(2);
if (!args.includes('--i-am-local')) throw new Error('Pass --i-am-local: this rewrites demo data and the dev bucket.');
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
const storage = new SpacesStorageAdapter({ key, secret, bucket, region, endpoint, cdnUrl });
const queue = new BullMqMediaJobQueue(config.redis);
const audit = { append: async <T>(entry: T) => entry };
const media = new MediaService(assets, new MongoMediaRoleRepository(), storage, queue, audit as never, config);
const admin = { type: 'admin' as const, id: 'adm_local_catalog' };

interface DemoPhoto {
	urls: Record<'card' | 'thumb', string>;
	image: ResolvedImage;
}

const upload = async (file: string, index: number): Promise<string> => {
	const contentType = CONTENT_TYPES[extname(file).toLowerCase()];
	if (!contentType) throw new Error(`${basename(file)}: convert it to JPEG first (see the header).`);
	const body = await readFile(file);
	const { width, height } = await sharp(body).metadata();
	if (!width || !height) throw new Error(`${basename(file)}: unreadable image`);
	const presigned = await media.presign(admin, {
		purpose: 'product',
		contentType,
		byteSize: body.byteLength,
		fileName: `${SLUG_PREFIX}-${index + 1}${extname(file).toLowerCase()}`,
		width,
		height,
	});
	await fetch(presigned.uploadUrl, { method: 'PUT', headers: presigned.headers, body });
	await media.finalize(admin, presigned.assetId);
	for (let attempt = 0; attempt < 180; attempt += 1) {
		const status = await media.status(admin, presigned.assetId);
		if (status.state === 'ready') return presigned.assetId;
		if (status.state === 'failed') throw new Error(`${basename(file)}: processing failed: ${status.error}`);
		await new Promise((settle) => setTimeout(settle, 1000));
	}
	throw new Error('worker did not finish (is `pnpm --filter @saha-textile/api worker:dev` running?)');
};

const toDemoPhoto = async (assetId: string): Promise<DemoPhoto> => {
	const [asset] = await assets.findManyByIds([assetId]);
	const image =
		asset && resolveImage({ asset, getUrl: (k) => storage.getUrl(k), locale: 'en', fallbackLocale: 'en' });
	const smallest = (role: string, width: number) =>
		image?.roles[role]?.find((source) => source.width >= width)?.url ?? image?.roles[role]?.at(-1)?.url;
	const card = smallest('card', 400);
	const thumb = smallest('thumb', 300);
	if (!image || !card || !thumb) throw new Error(`${assetId}: missing public card/thumb derivatives`);
	return { urls: { card, thumb }, image };
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Rewrites every product image slot under `node`; `productId` is the nearest product's id. */
const dress = (node: Json, photos: DemoPhoto[] | null, slot: SlotKind, productId = 0): void => {
	if (Array.isArray(node)) return node.forEach((child) => dress(child, photos, slot, productId));
	if (!node || typeof node !== 'object') return;
	const id =
		typeof node['product_id'] === 'number'
			? node['product_id']
			: typeof node['id'] === 'number' && 'slug' in node
				? node['id']
				: productId;
	for (const [field, value] of Object.entries(node)) {
		if (!PRODUCT_IMAGE_KEYS.has(field)) {
			dress(value, photos, slot, id);
			continue;
		}
		const slots = Array.isArray(value) ? value : [value];
		slots.forEach((attachment, position) => {
			if (
				!attachment ||
				typeof attachment !== 'object' ||
				Array.isArray(attachment) ||
				typeof attachment['original_url'] !== 'string'
			)
				return;
			const photo = photos?.[(id + position) % photos.length];
			delete attachment['image'];
			attachment['original_url'] = photo ? photo.urls[slot === 'thumb' ? 'thumb' : 'card'] : PLACEHOLDER_URL;
			if (photo && slot === 'card+srcset') {
				const roles = (CARRIED_ROLES[field] as string[]).map((role) => [role, photo.image.roles[role] ?? []]);
				attachment['image'] = { ...photo.image, roles: Object.fromEntries(roles) } as unknown as Json;
			}
		});
	}
};

const rewriteData = async (photos: DemoPhoto[] | null): Promise<void> => {
	for (const [file, slot] of Object.entries(DATA_FILES)) {
		const path = resolve(DATA_DIR, file);
		const data = JSON.parse(await readFile(path, 'utf8')) as Json;
		dress(data, photos, slot);
		// Through the repo's Prettier config, so a run leaves `pnpm format:check` clean.
		const options = { ...(await resolveConfig(path)), filepath: path };
		await writeFile(path, await format(JSON.stringify(data), options));
	}
};

const clean = async (): Promise<void> => {
	const owned = (await media.library({ purpose: 'product', search: SLUG_PREFIX, page: 1, pageSize: 100 })).items;
	for (const { asset } of owned)
		if (asset.slug.startsWith(SLUG_PREFIX)) await purgeAsset({ assets, storage, queue }, asset);
	await rewriteData(null);
	console.log(`Purged ${owned.length} photo(s); demo data back on the placeholder.`);
};

async function main(): Promise<void> {
	await connectMongo();
	try {
		if (args.includes('--clean')) return void (await clean());
		const photos: DemoPhoto[] = [];
		const reuse = args.find((arg) => arg.startsWith('--assets='));
		if (reuse) {
			for (const assetId of reuse.slice('--assets='.length).split(',')) photos.push(await toDemoPhoto(assetId));
		} else {
			const files = args
				.filter((arg) => !arg.startsWith('--'))
				.map((file) => resolve(process.env['INIT_CWD'] ?? process.cwd(), file));
			if (files.length === 0) throw new Error('Pass at least one photo, or --assets=<id,id> to reuse uploads.');
			for (const [index, file] of files.entries()) {
				const assetId = await upload(file, index);
				photos.push(await toDemoPhoto(assetId));
				console.log(`${basename(file)} → ${assetId}`);
			}
		}
		await rewriteData(photos);
		console.log(`Demo catalogue now uses ${photos.length} photo(s).`);
	} finally {
		await queue.close();
		await disconnectMongo();
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
