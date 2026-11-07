/**
 * Live banner check on real infrastructure (dev bucket, local Mongo/Redis, a running worker).
 *
 *   pnpm e2e:banners            upload art, save hero blocks, read them back, clean up
 *   pnpm e2e:banners --keep     leave them live for viewing on the storefront
 *   pnpm e2e:banners --clean    remove what a --keep run left
 *
 * Writes only `home:-:hero:*` blocks it owns (marked by the `e2e-hero` slug).
 */
import 'dotenv/config';

import {
	MongoContentBlockRepository,
	MongoMediaAssetRepository,
	MongoMediaRoleRepository,
	MongoSiteSettingsRepository,
	connectMongo,
	disconnectMongo,
} from '@saha-textile/adapters-db-mongo';
import { BullMqMediaJobQueue } from '@saha-textile/adapters-queue-bullmq';
import { SpacesStorageAdapter } from '@saha-textile/adapters-storage-spaces';
import { purgeAsset } from '@saha-textile/core-domain';
import sharp from 'sharp';

import { loadConfig } from '../src/config/app-config';
import { ContentBlocksService } from '../src/media/content-blocks.service';
import { MediaService } from '../src/media/media.service';

const config = loadConfig();
const { key, secret, bucket, region, endpoint, cdnUrl } = config.spaces;
if (!key || !secret || !bucket) throw new Error('Spaces credentials are required');
const assets = new MongoMediaAssetRepository();
const blocks = new MongoContentBlockRepository();
const settings = new MongoSiteSettingsRepository();
const storage = new SpacesStorageAdapter({ key, secret, bucket, region, endpoint, cdnUrl });
const queue = new BullMqMediaJobQueue(config.redis);
const audit = { append: async <T>(entry: T) => entry };
const media = new MediaService(assets, new MongoMediaRoleRepository(), storage, queue, audit as never, config);
const content = new ContentBlocksService(blocks, assets, settings, storage, config);
const admin = { type: 'admin' as const, id: 'adm_e2e' };

const art = async (width: number, height: number, label: string, rgb: [number, number, number]) => {
	const svg = `<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="rgb(${rgb.join(',')})"/><text x="50%" y="50%" font-size="${Math.round(height / 6)}" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text></svg>`;
	const body = await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
	const presigned = await media.presign(admin, {
		purpose: 'banner',
		contentType: 'image/jpeg',
		byteSize: body.byteLength,
		fileName: 'e2e-hero.jpg',
		width,
		height,
		maxDisplayWidth: 2560,
	});
	await fetch(presigned.uploadUrl, { method: 'PUT', headers: presigned.headers, body });
	await media.finalize(admin, presigned.assetId);
	for (let attempt = 0; attempt < 90; attempt += 1) {
		const status = await media.status(admin, presigned.assetId);
		if (status.state === 'ready') return presigned.assetId;
		if (status.state === 'failed') throw new Error(`banner processing failed: ${status.error}`);
		await new Promise((settle) => setTimeout(settle, 1000));
	}
	throw new Error('worker did not finish (is it running?)');
};

const clean = async () => {
	for (const block of await blocks.list({ ownerType: 'home', position: 'hero' })) {
		const ids = [block.images.desktop, block.images.tablet, block.images.phone].filter((id): id is string => !!id);
		const owned = await assets.findManyByIds(ids);
		if (!owned.every((asset) => asset.slug === 'e2e-hero')) continue;
		await blocks.deleteByKey(block.key);
		for (const asset of owned) await purgeAsset({ assets, storage, queue }, asset);
	}
	await settings.set('storefront.home', { heroLayout: 'hero_full' });
};

async function main(): Promise<void> {
	await connectMongo();
	try {
		if (process.argv.includes('--clean')) return void (await clean());
		const desktop = await art(2880, 864, 'DESKTOP 10:3', [65, 115, 148]);
		const phone = await art(1080, 1350, 'PHONE 4:5', [150, 40, 60]);
		await content.upsert({
			ownerType: 'home',
			ownerId: null,
			position: 'hero',
			slot: 'main',
			images: { desktop, tablet: null, phone },
			containsText: false,
			localeImages: {},
			heading: { en: 'The festive edit', fr: "L'édition festive" },
			subheading: { en: 'New arrivals', fr: 'Nouveautés' },
			ctaLabel: { en: 'Shop now', fr: 'Acheter' },
			link: { href: '/collections', external: false },
			alt: { en: 'Festive saree collection', fr: 'Collection de saris de fête' },
			status: 'active',
			startsAt: null,
			endsAt: null,
		});
		const read = await content.storefront({ ownerType: 'home', locale: 'fr' });
		const hero = read.banners.find((banner) => banner.key === 'home:-:hero:main');
		console.log(
			hero ? 'PASS  hero banner resolved for fr' : 'FAIL  hero banner missing',
			hero
				? `(${hero.heading}; desktop ${hero.images.desktop.roles.banner?.map((s) => s.width).join('/')}; phone ${hero.images.phone?.roles.banner?.map((s) => s.width).join('/')})`
				: '',
		);
		if (!process.argv.includes('--keep')) await clean();
		else console.log('kept: run `pnpm e2e:banners --clean` to remove');
	} finally {
		await queue.close();
		await disconnectMongo();
	}
}

void main();
