/**
 * Live end-to-end check of the media pipeline against REAL infrastructure: the dev Spaces
 * bucket, local Mongo and Redis, and a running worker (`pnpm worker:dev` or the mode-3 stack).
 *
 *   pnpm e2e:media
 *
 * presign → browser-style PUT of a generated 3:4 JPEG → finalize → worker renders every role
 * → each derivative is fetched from the public CDN URL → a private review photo is checked
 * to be unreadable publicly and readable through its signed URL → everything is deleted.
 * It writes only under fresh `med_…` prefixes and removes them, CDN purge included.
 */
import 'dotenv/config';

import {
	MongoMediaAssetRepository,
	MongoMediaRoleRepository,
	connectMongo,
	disconnectMongo,
} from '@saha-textile/adapters-db-mongo';
import { BullMqMediaJobQueue } from '@saha-textile/adapters-queue-bullmq';
import { SpacesStorageAdapter } from '@saha-textile/adapters-storage-spaces';
import { type MediaAsset } from '@saha-textile/contracts';
import { purgeAsset } from '@saha-textile/core-domain';
import sharp from 'sharp';

import { loadConfig } from '../src/config/app-config';
import { MediaService, type MediaUploader } from '../src/media/media.service';

const config = loadConfig();
const { key, secret, bucket, region, endpoint, cdnUrl } = config.spaces;
if (!key || !secret || !bucket) throw new Error('Spaces credentials are required for the media e2e');

const assets = new MongoMediaAssetRepository();
const storage = new SpacesStorageAdapter({ key, secret, bucket, region, endpoint, cdnUrl });
const queue = new BullMqMediaJobQueue(config.redis);
const audit = {
	append: async <T>(entry: T) => entry,
	list: async () => ({ items: [], total: 0, page: 1, pageSize: 1 }),
	purgeOlderThan: async () => 0,
};
const media = new MediaService(assets, new MongoMediaRoleRepository(), storage, queue, audit as never, config);

const check = (ok: boolean, label: string) => {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
	if (!ok) process.exitCode = 1;
};

const upload = async (uploader: MediaUploader, purpose: 'product' | 'review', width: number, height: number) => {
	const body = await sharp({ create: { width, height, channels: 3, background: { r: 180, g: 20, b: 60 } } })
		.jpeg({ quality: 90 })
		.toBuffer();
	const presigned = await media.presign(uploader, {
		purpose,
		contentType: 'image/jpeg',
		byteSize: body.byteLength,
		fileName: purpose === 'review' ? 'IMG_0001.jpg' : 'E2E Red Saree.jpg',
		width,
		height,
	});
	const put = await fetch(presigned.uploadUrl, { method: 'PUT', headers: presigned.headers, body });
	check(put.ok, `${purpose}: direct PUT to Spaces (HTTP ${put.status})`);
	await media.finalize(uploader, presigned.assetId);
	for (let attempt = 0; attempt < 90; attempt += 1) {
		const status = await media.status(uploader, presigned.assetId);
		if (status.state === 'ready' || status.state === 'failed') {
			check(
				status.state === 'ready',
				`${purpose}: worker processed it (${status.state}${status.error ? `: ${status.error}` : ''})`,
			);
			return { asset: (await assets.findById(presigned.assetId)) as MediaAsset, status };
		}
		await new Promise((settle) => setTimeout(settle, 1000));
	}
	check(false, `${purpose}: worker finished within 90 s (is the worker running?)`);
	return { asset: (await assets.findById(presigned.assetId)) as MediaAsset, status: null };
};

async function main(): Promise<void> {
	await connectMongo();
	const created: MediaAsset[] = [];
	try {
		const product = await upload({ type: 'admin', id: 'adm_e2e' }, 'product', 1800, 2400);
		created.push(product.asset);
		const roles = new Set(product.asset.derivatives.map((derivative) => derivative.role));
		check(
			['thumb', 'card', 'gallery', 'swatch_image', 'swatch_image_v2'].every((role) => roles.has(role)),
			`product: roles rendered (${[...roles].join(', ')})`,
		);
		check(!roles.has('zoom'), 'product: 2000 px zoom skipped for an 1800 px source (never upscale)');
		check(
			!!product.asset.thumbHash && !!product.asset.dominantColor,
			'product: ThumbHash and dominant colour stored',
		);
		const card = product.asset.derivatives.find(
			(derivative) => derivative.role === 'card' && derivative.width === 400,
		);
		if (card) {
			const response = await fetch(storage.getUrl(card.storageKey));
			check(
				response.ok && response.headers.get('content-type') === 'image/webp',
				`product: CDN serves card 400w as WebP (HTTP ${response.status})`,
			);
			check(
				(response.headers.get('cache-control') ?? '').includes('immutable'),
				'product: derivative carries the immutable cache header',
			);
		}
		if (product.asset.originalStorageKey) {
			const original = await fetch(storage.getUrl(product.asset.originalStorageKey));
			check(
				original.status === 403 || original.status === 404,
				`product: original is not publicly readable (HTTP ${original.status})`,
			);
		}

		const review = await upload({ type: 'customer', id: 'cus_e2e' }, 'review', 3024, 4032);
		created.push(review.asset);
		check(review.asset.originalStorageKey === null, 'review: original discarded after processing');
		const thumb = review.asset.derivatives.find((derivative) => derivative.role === 'review_thumb');
		if (thumb) {
			const publicRead = await fetch(storage.getUrl(thumb.storageKey));
			check(
				publicRead.status === 403 || publicRead.status === 404,
				`review: photo not public before approval (HTTP ${publicRead.status})`,
			);
			const signed = await fetch(
				await storage.createSignedDownloadUrl({ key: thumb.storageKey, expiresInSeconds: 60 }),
			);
			check(signed.ok, `review: moderator signed URL works (HTTP ${signed.status})`);
		}
	} finally {
		for (const asset of created) {
			const fresh = await assets.findById(asset.id);
			if (fresh) await purgeAsset({ assets, storage, queue }, fresh);
		}
		console.log(`cleanup: queued deletion of ${created.length} asset(s)' objects and removed their records`);
		await queue.close();
		await disconnectMongo();
	}
}

void main();
