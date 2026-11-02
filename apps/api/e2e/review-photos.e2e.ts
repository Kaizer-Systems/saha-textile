/**
 * Live review-photo check on real infrastructure (dev bucket, local Mongo/Redis, a worker).
 *
 *   pnpm e2e:review-photos           upload, file a pending review, approve, verify, clean up
 *   pnpm e2e:review-photos --keep    leave the pending review for the admin moderation screen
 *   pnpm e2e:review-photos --clean   remove what a --keep run left
 *
 * Uses an existing product and customer; the review is marked by its body text.
 */
import 'dotenv/config';

import {
	CustomerModel,
	MongoMediaAssetRepository,
	MongoMediaRoleRepository,
	MongoReviewRepository,
	ProductModel,
	ReviewModel,
	connectMongo,
	disconnectMongo,
} from '@saha-textile/adapters-db-mongo';
import { BullMqMediaJobQueue } from '@saha-textile/adapters-queue-bullmq';
import { SpacesStorageAdapter } from '@saha-textile/adapters-storage-spaces';
import { discardReviewPhotos, publishReviewPhotos } from '@saha-textile/core-domain';
import sharp from 'sharp';

import { loadConfig } from '../src/config/app-config';
import { MediaService } from '../src/media/media.service';

const MARKER = 'E2E review photo check';
const config = loadConfig();
const { key, secret, bucket, region, endpoint, cdnUrl } = config.spaces;
if (!key || !secret || !bucket) throw new Error('Spaces credentials are required');
const assets = new MongoMediaAssetRepository();
const reviews = new MongoReviewRepository();
const storage = new SpacesStorageAdapter({ key, secret, bucket, region, endpoint, cdnUrl });
const queue = new BullMqMediaJobQueue(config.redis);
const media = new MediaService(assets, new MongoMediaRoleRepository(), storage, queue, { append: async () => undefined } as never, config);
const deps = { assets, storage, queue };
const check = (ok: boolean, label: string) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);

const clean = async () => {
	for (const doc of await ReviewModel.find({ body: MARKER }).lean().exec()) {
		await discardReviewPhotos(deps, doc.imageAssetIds);
		await ReviewModel.deleteOne({ _id: doc._id }).exec();
	}
};

async function main(): Promise<void> {
	await connectMongo();
	try {
		if (process.argv.includes('--clean')) return void (await clean());
		const product = await ProductModel.findOne().lean().exec();
		const customer = await CustomerModel.findOne().lean().exec();
		if (!product || !customer) throw new Error('needs one product and one customer in the database');
		const uploader = { type: 'customer' as const, id: String(customer._id) };

		const body = await sharp({ create: { width: 3024, height: 4032, channels: 3, background: { r: 120, g: 60, b: 90 } } }).jpeg().toBuffer();
		const presigned = await media.presign(uploader, {
			purpose: 'review', contentType: 'image/jpeg', byteSize: body.byteLength, fileName: 'IMG_4031.jpg', width: 3024, height: 4032, slug: 'e2e-customer-photo',
		});
		await fetch(presigned.uploadUrl, { method: 'PUT', headers: presigned.headers, body });
		await media.finalize(uploader, presigned.assetId);
		let state = 'queued';
		for (let attempt = 0; attempt < 90 && state !== 'ready' && state !== 'failed'; attempt += 1) {
			await new Promise((settle) => setTimeout(settle, 1000));
			state = (await media.status(uploader, presigned.assetId)).state;
		}
		check(state === 'ready', `photo processed (${state})`);

		await reviews.create({
			id: `rev_e2e_${Date.now()}`, productId: String(product._id), userId: String(customer._id), orderId: `ord_e2e_${Date.now()}`,
			rating: 5, title: 'Beautiful drape', body: MARKER, imageAssetIds: [presigned.assetId], status: 'pending',
			moderatedByUserId: null, moderatedAt: null, moderationNote: null, createdAt: new Date().toISOString(),
		});
		const thumb = (await assets.findById(presigned.assetId))?.derivatives.find((d) => d.role === 'review_thumb');
		const before = thumb ? (await fetch(storage.getUrl(thumb.storageKey))).status : 0;
		check(before === 403, `pending photo not public (HTTP ${before})`);

		if (process.argv.includes('--keep')) return void console.log('kept: pending review left for the admin screen');

		await publishReviewPhotos(deps, [presigned.assetId]);
		const after = thumb ? (await fetch(`${storage.getUrl(thumb.storageKey)}?v=${Date.now()}`)).status : 0;
		check(after === 200, `approved photo public (HTTP ${after})`);
		await clean();
	} finally {
		await queue.close();
		await disconnectMongo();
	}
}

void main();
