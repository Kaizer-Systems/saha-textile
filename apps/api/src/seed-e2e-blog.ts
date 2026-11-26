import 'dotenv/config';
import 'reflect-metadata';

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
	MongoBlogCategoryRepository,
	MongoBlogPostRepository,
	MongoBlogTagRepository,
	MongoMediaAssetRepository,
	MongoSeoRedirectRepository,
	connectMongo,
	disconnectMongo,
} from '@saha-textile/adapters-db-mongo';
import { SpacesStorageAdapter } from '@saha-textile/adapters-storage-spaces';
import { BlogPostWrite, type ImageDerivative, MediaAsset } from '@saha-textile/contracts';
import sharp from 'sharp';

import { BlogAdminService } from './blog/blog-admin.service';
import { loadConfig } from './config/app-config';
import { LanguageStore } from './languages/language-store';

/**
 * BROWSER-TEST DATABASE ONLY: gives `saha_textile_e2e` three live blog posts, so Home's blog section
 * and the blog pages have posts to show.
 *
 *   pnpm --filter @saha-textile/api seed:e2e-blog
 *
 * The e2e stack runs no image worker, so each cover's blog sizes are made here, from a theme picture
 * in the repo, at fixed addresses in the bucket. A run that finds them there uploads nothing. The
 * posts go through the blog's own service: saved as drafts, then Go Live with its checks.
 *
 * Run by `pnpm e2e:stack` after the demo catalogue. Excluded from `nest build`.
 */

const DATABASE = 'saha_textile_e2e';
const THEMES = resolve(__dirname, '../../storefront/public/assets/images/data/themes');
/** The blog role's widths (core seeded-roles), no wider than the picture. */
const BLOG_WIDTHS = [480, 800, 1200, 1600, 2400];
/** Part of every address, so a later change of picture gets new addresses instead of a stale CDN copy. */
const EDITION = 'e2e00001';

interface Cover {
	id: string;
	file: string;
	alt: { en: string; bn: string };
}

interface Post {
	slug: string;
	publishedAt: string;
	cover: Cover;
	title: { en: string; bn: string };
	excerpt: { en: string; bn: string };
	content: { en: string; bn: string };
}

const POSTS: Post[] = [
	{
		slug: 'how-to-choose-a-banarasi-saree',
		publishedAt: '2026-11-03T05:00:00.000Z',
		cover: {
			id: 'med_0e2eb100-0000-4000-8000-000000000001',
			file: 'berlin/1.jpg',
			alt: { en: 'Sarees on display in the shop', bn: 'দোকানে সাজানো শাড়ি' },
		},
		title: { en: 'How to choose a Banarasi saree', bn: 'বেনারসী শাড়ি কীভাবে বাছবেন' },
		excerpt: {
			en: 'What to look at in the weave, the zari and the border before you buy.',
			bn: 'কেনার আগে বুনন, জরি আর পাড়ে কী দেখবেন।',
		},
		content: {
			en: '<p>A Banarasi saree is woven on a handloom in Varanasi. Look at the back of the weave: loose threads there show it was made by hand.</p>',
			bn: '<p>বেনারসী শাড়ি বারাণসীর হ্যান্ডলুমে বোনা হয়। বুননের উল্টো দিকটা দেখুন: সেখানে আলগা সুতো থাকলে বুঝবেন শাড়িটা হাতে বোনা।</p>',
		},
	},
	{
		slug: 'caring-for-silk-sarees',
		publishedAt: '2026-11-02T05:00:00.000Z',
		cover: {
			id: 'med_0e2eb100-0000-4000-8000-000000000002',
			file: 'madrid/3.jpg',
			alt: { en: 'Folded silk sarees', bn: 'ভাঁজ করা সিল্কের শাড়ি' },
		},
		title: { en: 'Caring for silk sarees', bn: 'সিল্কের শাড়ির যত্ন' },
		excerpt: {
			en: 'Folding, storing and cleaning silk so it lasts for years.',
			bn: 'সিল্ক বহু বছর ভালো রাখতে ভাঁজ, রাখা আর পরিষ্কারের নিয়ম।',
		},
		content: {
			en: '<p>Refold a silk saree every few months so the creases do not set, and keep it in a cotton cloth, away from sunlight.</p>',
			bn: '<p>কয়েক মাস পরপর সিল্কের শাড়ির ভাঁজ বদলে দিন, যাতে ভাঁজের দাগ না বসে। সুতির কাপড়ে মুড়ে রোদ থেকে দূরে রাখুন।</p>',
		},
	},
	{
		slug: 'cotton-sarees-for-summer',
		publishedAt: '2026-11-01T05:00:00.000Z',
		cover: {
			id: 'med_0e2eb100-0000-4000-8000-000000000003',
			file: 'madrid/6.jpg',
			alt: { en: 'Light cotton sarees', bn: 'হালকা সুতির শাড়ি' },
		},
		title: { en: 'Cotton sarees for summer', bn: 'গরমের জন্য সুতির শাড়ি' },
		excerpt: {
			en: 'Light weaves from Bengal that stay cool on hot days.',
			bn: 'বাংলার হালকা বুনন, গরমের দিনেও আরাম।',
		},
		content: {
			en: '<p>Tant and mulmul cottons from Bengal are light and let air through, which makes them the easiest sarees to wear in the heat.</p>',
			bn: '<p>বাংলার তাঁত আর মলমল সুতির শাড়ি হালকা, হাওয়া চলাচল করে, তাই গরমে পরার জন্য এগুলোই সবচেয়ে আরামের।</p>',
		},
	},
];

const CATEGORY = { slug: 'saree-guides', name: { en: 'Saree guides', bn: 'শাড়ির গাইড' } };

if (process.env['MONGODB_DB_NAME'] !== DATABASE) throw new Error(`Refused: this seeds ${DATABASE} only.`);
const mongoHost = (process.env['MONGODB_HOST'] || '127.0.0.1').toLowerCase();
if (!['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(mongoHost))
	throw new Error(`Refused: MONGODB_HOST=${mongoHost} is not a loopback host.`);

const config = loadConfig();
const { key, secret, bucket, region, endpoint, cdnUrl } = config.spaces;
if (!key || !secret || !bucket) throw new Error('Spaces credentials are required');
const storage = new SpacesStorageAdapter({ key, secret, bucket, region, endpoint, cdnUrl });
const assets = new MongoMediaAssetRepository();
const posts = new MongoBlogPostRepository();
const categories = new MongoBlogCategoryRepository();
const blog = new BlogAdminService(
	posts,
	categories,
	new MongoBlogTagRepository(),
	assets,
	new MongoSeoRedirectRepository(),
	storage,
	LanguageStore.fixed(config.locales),
);

const isStored = async (storageKey: string): Promise<boolean> => {
	const answer = await fetch(storage.getUrl(storageKey), { method: 'HEAD' });
	return answer.ok;
};

/** The cover's blog sizes, made from a 2:1 cut of the theme picture; uploaded only where missing. */
async function coverAsset(cover: Cover, index: number): Promise<void> {
	if (await assets.findById(cover.id)) return;
	const source = await readFile(resolve(THEMES, cover.file));
	const meta = await sharp(source).metadata();
	if (!meta.width || !meta.height) throw new Error(`${cover.file}: unreadable picture`);
	const width = Math.min(meta.width, meta.height * 2);
	const height = Math.round(width / 2);
	const cut = await sharp(source).resize({ width, height, fit: 'cover', position: 'centre' }).toBuffer();
	const derivatives: ImageDerivative[] = [];
	for (const size of BLOG_WIDTHS.filter((candidate) => candidate <= width)) {
		const storageKey = `media/${cover.id}/e2e-blog-cover-${index + 1}-blog-${size}w-${EDITION}.webp`;
		const sizeHeight = Math.round(size / 2);
		let byteSize = 0;
		if (!(await isStored(storageKey))) {
			const body = await sharp(cut).resize({ width: size, height: sizeHeight }).webp({ quality: 82 }).toBuffer();
			await storage.upload({
				key: storageKey,
				body: new Uint8Array(body),
				contentType: 'image/webp',
				cacheControl: 'public, max-age=31536000, immutable',
			});
			byteSize = body.byteLength;
		}
		derivatives.push({
			role: 'blog',
			storageKey,
			width: size,
			height: sizeHeight,
			byteSize,
			format: 'image/webp',
			roleVersion: 1,
		});
	}
	await assets.create(
		MediaAsset.parse({
			id: cover.id,
			kind: 'image',
			purpose: 'blog',
			originalStorageKey: null,
			originalFormat: 'image/jpeg',
			originalByteSize: 0,
			width,
			height,
			slug: `e2e-blog-cover-${index + 1}`,
			derivatives,
			dominantColor: '#d8cfc4',
			thumbHash: null,
			visibility: 'public',
			processing: { state: 'ready', attempts: 1, error: null, processedAt: '2026-11-23T00:00:00.000Z' },
			warnings: [],
			servesAsPrimary: false,
			maxDisplayWidth: null,
			renditions: [],
			hlsPlaylistKey: null,
			durationSeconds: null,
			text: { alt: cover.alt, title: {}, caption: {} },
			status: 'live',
			uploadedBy: null,
			deletedAt: null,
		}),
	);
}

async function main(): Promise<void> {
	await connectMongo();
	try {
		const category =
			(await categories.findBySlug(CATEGORY.slug))?.id ??
			(await blog.saveTerm('category', null, { ...CATEGORY, description: {}, status: 'live' }, null)).id;
		for (const [index, post] of POSTS.entries()) {
			const existing = await posts.findBySlug(post.slug);
			if (existing?.status === 'live') {
				console.log(`${post.slug}: already live`);
				continue;
			}
			await coverAsset(post.cover, index);
			const id =
				existing?.id ??
				(
					await blog.create(
						BlogPostWrite.parse({
							title: post.title,
							slug: post.slug,
							excerpt: post.excerpt,
							content: post.content,
							coverAssetId: post.cover.id,
							categoryIds: [category],
							publishedAt: post.publishedAt,
						}),
						null,
					)
				).post.id;
			const live = await blog.goLive(id, null);
			if (!live.live) throw new Error(`${post.slug}: Go Live refused ${JSON.stringify(live.gaps)}`);
			console.log(`${post.slug}: live`);
		}
	} finally {
		await disconnectMongo();
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
