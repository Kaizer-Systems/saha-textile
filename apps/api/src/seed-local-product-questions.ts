import 'dotenv/config';
import 'reflect-metadata';

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
	MongoAdminUserRepository,
	MongoProductQuestionRepository,
	MongoProductRepository,
	connectMongo,
	disconnectMongo,
} from '@saha-textile/adapters-db-mongo';
import { z } from 'zod';

import { ContentService } from './catalog/content.service';

/**
 * LOCAL-ONLY: loads demo shopper questions and their answers from a JSON file.
 *
 *   pnpm --filter @saha-textile/api seed:local-product-questions -- --i-am-local \
 *     --file <questions.json> --answered-by <admin email>
 *
 * Each row goes through the same `ContentService.ask` and `ContentService.answer` the shop form
 * and the admin Q&A screen call, so the rows are exactly what those screens would write. It skips
 * the shop's per-address spam limit (30 questions an hour), which is the only reason it exists:
 * a demo catalogue needs hundreds. No email is sent, because no notifier is wired here.
 *
 * A question already asked by the same email on the same product is skipped, so a second run adds
 * nothing. Excluded from `nest build`.
 */

const Row = z.object({
	productSlug: z.string().min(1),
	question: z.string().min(1).max(2000),
	askerName: z.string().min(1).max(120),
	askerEmail: z.email(),
	answer: z.string().min(1).max(4000),
});
const File = z.array(Row);

const args = process.argv.slice(2);
const flag = (name: string) => {
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : undefined;
};
if (!args.includes('--i-am-local')) throw new Error('Pass --i-am-local: this writes to the database.');
if (process.env['NODE_ENV'] === 'production') throw new Error('Refused: NODE_ENV=production.');
const mongoHost = (process.env['MONGODB_HOST'] || '127.0.0.1').toLowerCase();
if (!['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(mongoHost))
	throw new Error(`Refused: MONGODB_HOST=${mongoHost} is not a loopback host.`);
if (!/_local$/.test(process.env['MONGODB_DB_NAME'] ?? ''))
	throw new Error('Refusing: MONGODB_DB_NAME must end in _local.');
const file = flag('--file');
const answeredBy = flag('--answered-by');
if (!file || !answeredBy) throw new Error('Pass --file <questions.json> and --answered-by <admin email>.');

async function main() {
	await connectMongo();
	try {
		const rows = File.parse(JSON.parse(await readFile(resolve(file as string), 'utf8')));
		const admin = await new MongoAdminUserRepository().findByEmail(answeredBy as string);
		if (!admin) throw new Error(`No admin user with the email ${answeredBy}.`);
		const questions = new MongoProductQuestionRepository();
		const products = new MongoProductRepository();
		const content = new ContentService(products, null, questions, null, null);
		let added = 0;
		let skipped = 0;
		for (const row of rows) {
			const product = await products.findBySlug(row.productSlug, 'public');
			if (!product) throw new Error(`No live product with the slug ${row.productSlug}.`);
			const answered = await questions.listAnsweredForProduct(product.id, { page: 1, pageSize: 50 });
			if (answered.items.some((item) => item.question === row.question)) {
				skipped += 1;
				continue;
			}
			const asked = await content.ask({ ...row, isAnonymous: false }, null);
			await content.answer(asked.id, row.answer, admin.id);
			added += 1;
		}
		console.log(`Questions answered: ${added}. Already there: ${skipped}.`);
	} finally {
		await disconnectMongo();
	}
}

void main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
