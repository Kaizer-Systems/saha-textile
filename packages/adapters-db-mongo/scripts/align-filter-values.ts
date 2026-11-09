/**
 * LOCAL-ONLY: makes the showcase catalogue's filter values agree with product titles and with the
 * attribute lists, the same rules a fresh `seed:showcase-catalogue` now applies.
 *
 *   pnpm --filter @saha-textile/adapters-db-mongo align:filter-values -- --i-am-local [--dry-run]
 *
 * 1. Work, Pattern and Fabric: a value the title names wins (`workFor`, `patternFor`, `fabricFor`);
 *    a title that names none keeps what the product has, including anything set in the admin.
 * 2. Each attribute's list gains every value a product uses, with that value's labels, so the
 *    admin's pickers and the shop's filters offer the same values.
 *
 * Only filter groups change; nothing else on a product is touched. Rebuild the search index
 * afterwards (`pnpm --filter @saha-textile/api search:rebuild`) so listings and filter counts follow.
 */
import { connectMongo, disconnectMongo } from '../src/connection';
import { AttributeDefinitionModel, ProductModel } from '../src/models/index';
import { fabricFor, patternFor, workFor } from './showcase-catalogue-data';

type Label = Record<string, string>;
interface Term {
	code: string;
	label: Label;
	isBase?: boolean;
	[key: string]: unknown;
}
interface Group {
	attributeCode: string;
	semanticRole: string;
	terms: Term[];
	[key: string]: unknown;
}

const RULES: Record<string, (title: string, fallback: string) => string> = {
	work: workFor,
	pattern: patternFor,
	fabric: fabricFor,
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
if (!args.includes('--i-am-local')) throw new Error('Pass --i-am-local: this writes to the database.');
if (process.env['NODE_ENV'] === 'production') throw new Error('Refused: NODE_ENV=production.');
const host = (process.env['MONGODB_HOST'] || '127.0.0.1').toLowerCase();
if (!['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(host))
	throw new Error(`Refused: MONGODB_HOST=${host} is not a loopback host.`);
if (!/_local$/.test(process.env['MONGODB_DB_NAME'] ?? ''))
	throw new Error('Refused: MONGODB_DB_NAME must end in _local.');

async function main(): Promise<void> {
	await connectMongo();
	try {
		const products = await ProductModel.find({})
			.select('_id title optionGroups')
			.lean<Array<{ _id: string; title: Label; optionGroups: Group[] }>>()
			.exec();

		// Every value in use, with its labels, per attribute: the labels a corrected product borrows.
		const used = new Map<string, Map<string, Term>>();
		const remember = (code: string, term: Term) => {
			const values = used.get(code) ?? new Map<string, Term>();
			if (!values.has(term.code)) values.set(term.code, term);
			used.set(code, values);
		};
		for (const product of products) {
			for (const group of product.optionGroups ?? [])
				for (const term of group.terms) remember(group.attributeCode, term);
		}

		const changes: Record<string, number> = {};
		let changedProducts = 0;
		for (const product of products) {
			let changed = false;
			const groups = (product.optionGroups ?? []).map((group) => {
				const rule = RULES[group.attributeCode];
				const current = group.terms[0];
				if (!rule || group.semanticRole !== 'filter_only' || group.terms.length !== 1 || !current) return group;
				const wanted = rule(product.title['en'] ?? '', current.label['en'] ?? '');
				if (wanted === current.label['en']) return group;
				const term = [...(used.get(group.attributeCode)?.values() ?? [])].find(
					(row) => row.label['en'] === wanted,
				);
				if (!term) throw new Error(`No ${group.attributeCode} value "${wanted}" with labels to copy.`);
				changed = true;
				const key = `${group.attributeCode}: ${current.label['en']} -> ${wanted}`;
				changes[key] = (changes[key] ?? 0) + 1;
				return { ...group, terms: [{ ...current, code: term.code, label: term.label }] };
			});
			if (!changed) continue;
			changedProducts += 1;
			if (!dryRun) await ProductModel.updateOne({ _id: product._id }, { $set: { optionGroups: groups } }).exec();
		}

		let addedValues = 0;
		const definitions = await AttributeDefinitionModel.find({})
			.lean<Array<{ _id: string; code: string; terms: Array<{ code: string }> }>>()
			.exec();
		for (const definition of definitions) {
			const known = new Set(definition.terms.map((term) => term.code));
			const added = [...(used.get(definition.code)?.values() ?? [])]
				.filter((term) => !known.has(term.code))
				.map((term) => ({
					code: term.code,
					label: term.label,
					slug: term.code,
					aliases: [],
					isBase: term.isBase ?? false,
					hidden: false,
				}));
			if (!added.length) continue;
			addedValues += added.length;
			console.log(
				`[align-filter-values] ${definition.code}: + ${added.map((term) => term.label['en']).join(', ')}`,
			);
			if (!dryRun) {
				await AttributeDefinitionModel.updateOne(
					{ _id: definition._id },
					{ $push: { terms: { $each: added } } },
				).exec();
			}
		}

		for (const [key, count] of Object.entries(changes).sort())
			console.log(`[align-filter-values] ${key}: ${count}`);
		console.log(
			`[align-filter-values] ${dryRun ? 'DRY RUN — ' : ''}${changedProducts} products corrected, ${addedValues} values added to attribute lists`,
		);
	} finally {
		await disconnectMongo();
	}
}

main().catch((error: unknown) => {
	console.error('[align-filter-values] failed:', error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
