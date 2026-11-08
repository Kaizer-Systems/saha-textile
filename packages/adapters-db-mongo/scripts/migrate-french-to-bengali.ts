/**
 * Moves stored French to Bengali (owner decision round 2026-11-08, "Bengali replaces French").
 *
 *   pnpm --filter @saha-textile/adapters-db-mongo migrate:french-to-bengali            # counts only
 *   pnpm --filter @saha-textile/adapters-db-mongo migrate:french-to-bengali -- --write # changes rows
 *
 * Run `seed:showcase-catalogue` first on a local database: the catalogue builder rewrites every
 * product, category, filter and template with Bengali, keeping their IDs. This script then walks
 * every collection. Each language object holding French (`{ en, fr }`) gets its Bengali from the
 * object itself or from the translation table below, and loses its French. Page addresses stored
 * for `/fr/` are deleted; the catalogue writes the `/bn/` ones.
 *
 * Nothing is written while any French value lacks Bengali: the script lists them and stops, so
 * English is never copied into a Bengali field. Take a backup before `--write`.
 */
import mongoose from 'mongoose';

import { connectMongo, disconnectMongo } from '../src/connection';
import { assertLocalDatabase } from '../src/seed/seed-demo-catalogue';

/**
 * Bengali for stored text the catalogue builder does not write: the home banners and the SEO
 * text of their pictures. Keyed by the English, read by the owner on the review page.
 */
const TRANSLATIONS: Readonly<Record<string, string>> = {
	'Red Katan Banarasi silk wedding saree with a gold zari border and pallu, draped over a carved wooden chair beside a marigold garland':
		'খোদাই করা কাঠের চেয়ারে রাখা সোনালি জরির পাড় ও আঁচলের লাল কাতান বেনারসি সিল্কের বিয়ের শাড়ি, পাশে গাঁদা ফুলের মালা',
	'Shop Wedding Banarasi': 'বিয়ের বেনারসি দেখুন',
	'Wedding Banarasi, woven in Varanasi': 'বিয়ের বেনারসি, বারাণসীর তাঁতে বোনা',
	'Bridal silk sarees': 'বিয়ের সিল্ক শাড়ি',
	'White Bengal tant cotton saree with a red border and an off-white Jamdani, folded on a cane mora stool beside shiuli flowers and a brass bowl':
		'লাল পাড়ের সাদা তাঁতের সুতির শাড়ি আর অফ হোয়াইট জামদানি, বেতের মোড়ায় ভাঁজ করে রাখা, পাশে শিউলি ফুল আর পিতলের বাটি',
	'Shop Bengal Handloom': 'বাংলার তাঁত দেখুন',
	"Bengal's own handloom": 'বাংলার নিজের তাঁত',
	'Tant and Jamdani cotton sarees': 'তাঁত আর জামদানি সুতির শাড়ি',
	'Blush pink georgette saree with sequins draped on a brass rail, beside an ivory chikankari kurta set folded on a wooden bench':
		'পিতলের রেলে ঝোলানো চুমকির কাজের হালকা গোলাপি জর্জেট শাড়ি, পাশে কাঠের বেঞ্চে ভাঁজ করা আইভরি চিকনকারি কুর্তা সেট',
	'Shop Party Wear': 'পার্টি ওয়্যার দেখুন',
	'Made for evenings': 'সন্ধের সাজের জন্য',
	'Party wear sarees': 'পার্টি ওয়্যার শাড়ি',
	'Saha Textile collection': 'সাহা টেক্সটাইলের কালেকশন',
	'Red Banarasi silk wedding saree': 'লাল বেনারসি সিল্কের বিয়ের শাড়ি',
	'Katan Banarasi silk woven in Varanasi, with an antique-gold zari pallu.':
		'বারাণসীতে বোনা কাতান বেনারসি সিল্ক, অ্যান্টিক গোল্ড জরির আঁচল।',
	'Bengal handloom tant and Jamdani cotton sarees': 'বাংলার তাঁতের সুতির শাড়ি, তাঁত আর জামদানি',
	'Handwoven Bengal cotton: a red-bordered tant and a fine Jamdani.':
		'হাতে বোনা বাংলার সুতি: লাল পাড়ের তাঁত আর মিহি জামদানি।',
	'Blush pink sequin georgette saree and chikankari suit': 'চুমকির কাজের হালকা গোলাপি জর্জেট শাড়ি আর চিকনকারি স্যুট',
	'Evening wear: sequinned georgette and hand-embroidered chikankari.':
		'সন্ধের সাজ: চুমকির কাজের জর্জেট আর হাতে করা চিকনকারি।',
};

type Plain = Record<string, unknown>;

const isPlain = (value: unknown): value is Plain =>
	typeof value === 'object' &&
	value !== null &&
	!Array.isArray(value) &&
	!(value instanceof Date) &&
	!('_bsontype' in value);

interface Change {
	set: Record<string, string>;
	unset: string[];
	missing: string[];
	stray: string[];
}

/** Finds every language object holding French, and every other key named `fr`. */
function plan(value: unknown, path: string, change: Change): void {
	if (Array.isArray(value)) {
		value.forEach((item, index) => plan(item, `${path}.${index}`, change));
		return;
	}
	if (!isPlain(value)) return;
	if ('fr' in value) {
		const here = path ? `${path}.` : '';
		if (typeof value['en'] === 'string') {
			const bengali = typeof value['bn'] === 'string' && value['bn'] ? null : TRANSLATIONS[value['en']];
			if (typeof value['bn'] === 'string' && value['bn']) change.unset.push(`${here}fr`);
			else if (bengali) {
				change.set[`${here}bn`] = bengali;
				change.unset.push(`${here}fr`);
			} else change.missing.push(`${here}en = ${JSON.stringify(value['en'])}`);
		} else change.stray.push(`${here}fr`);
	}
	for (const [key, child] of Object.entries(value)) {
		if (key === 'fr') continue;
		plan(child, path ? `${path}.${key}` : key, change);
	}
}

async function main(): Promise<void> {
	const write = process.argv.includes('--write');
	const dbName = assertLocalDatabase(process.env['MONGODB_DB_NAME']);
	await connectMongo();
	const db = mongoose.connection.db;
	if (!db) throw new Error('No database connection');

	const updates: Array<{ collection: string; id: unknown; set: Record<string, string>; unset: string[] }> = [];
	const problems: string[] = [];
	for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
		if (name.startsWith('system.')) continue;
		let documents = 0;
		let fields = 0;
		for await (const doc of db.collection(name).find({})) {
			const change: Change = { set: {}, unset: [], missing: [], stray: [] };
			const { _id, ...rest } = doc;
			plan(rest, '', change);
			for (const line of change.missing) problems.push(`${name} ${String(_id)}: no Bengali for ${line}`);
			for (const line of change.stray)
				problems.push(`${name} ${String(_id)}: French key outside a language object at ${line}`);
			if (change.unset.length === 0) continue;
			documents += 1;
			fields += change.unset.length;
			updates.push({ collection: name, id: _id, set: change.set, unset: change.unset });
		}
		if (documents) console.log(`${name}: ${fields} French value(s) in ${documents} row(s)`);
	}
	const frenchRoutes = await db.collection('seoRoutes').countDocuments({ locale: 'fr' });
	console.log(`seoRoutes: ${frenchRoutes} French page address(es)`);

	if (problems.length) {
		console.error(`\n${problems.length} French value(s) have no Bengali. Nothing was written:`);
		for (const line of problems.slice(0, 50)) console.error(`  ${line}`);
		process.exitCode = 1;
	} else if (!write) {
		console.log(`\nDry run on ${dbName}: nothing written. Add --write to apply.`);
	} else {
		for (const { collection, id, set, unset } of updates) {
			await db.collection(collection).updateOne(
				{ _id: id as never },
				{
					...(Object.keys(set).length ? { $set: set } : {}),
					$unset: Object.fromEntries(unset.map((path) => [path, ''])),
				},
			);
		}
		const removed = await db.collection('seoRoutes').deleteMany({ locale: 'fr' });
		console.log(
			`\nWrote ${updates.length} row(s) and removed ${removed.deletedCount} French page address(es) on ${dbName}.`,
		);
	}
	await disconnectMongo();
}

main().catch((error: unknown) => {
	console.error('[migrate:french-to-bengali] failed:', error);
	process.exitCode = 1;
});
