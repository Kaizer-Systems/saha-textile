import { WRITTEN_LANGUAGE_AREAS, type WrittenLanguageArea } from '@saha-textile/contracts';
import type { LanguageCoverageRepository } from '@saha-textile/core-domain';

import { ProductModel } from '../models/index';
import {
	LOCALIZED_TEXT_REGISTRY,
	eraseUpdate,
	heldTextFilter,
	missingTextFilter,
	type LocalizedTextEntry,
	type TextFilter,
} from './localized-text-registry';
import { MEDIA_OWNER_REGISTRY } from './media-owner-registry';

/**
 * Which of a photo's owners the shop shows. A photo counts as used by the website when one of
 * these points at it; a photo only drafts use waits until they go live, and unused photos in Media
 * never count.
 */
const SHOWN_OWNERS: Readonly<Record<string, Record<string, unknown>>> = {
	Product: { status: 'live' },
	ProductVariant: { status: 'live' },
	Review: { status: 'approved' },
	ContentBlock: { status: 'active' },
	BlogPost: { status: 'live' },
	StoreLocation: { active: true },
	ShopEvent: { status: { $in: ['scheduled', 'live'] } },
};

/** Ids are strings here; a gallery entry may be a bare id or `{ assetId }`. */
const ids = (values: unknown[]): string[] => values.filter((value): value is string => typeof value === 'string');

type Document = Record<string, unknown>;

/** Removes `code` from every `{ en, bn, … }` object a path reaches inside a plain value. */
function stripPath(value: unknown, steps: readonly string[], code: string): boolean {
	if (value === null || typeof value !== 'object') return false;
	if (Array.isArray(value)) return value.map((item) => stripPath(item, steps, code)).some(Boolean);
	const [head, ...rest] = steps;
	const record = value as Document;
	if (head === undefined) {
		if (!(code in record)) return false;
		delete record[code];
		return true;
	}
	return stripPath(record[head], rest, code);
}

/**
 * The text stored per language, read through `LOCALIZED_TEXT_REGISTRY`: what is still empty among
 * the things the shop shows, which items hold a language's text, and erase.
 */
export class MongoLanguageCoverageRepository implements LanguageCoverageRepository {
	/** Photos the shop shows somewhere, by id. */
	private async shownPhotoIds(): Promise<string[]> {
		const found = new Set<string>();
		for (const owner of MEDIA_OWNER_REGISTRY) {
			const filter = (SHOWN_OWNERS[owner.model.modelName] ?? {}) as TextFilter;
			for (const id of ids(await owner.model.collection.distinct(owner.path, filter))) found.add(id);
		}
		return [...found];
	}

	private async missingFilter(entry: LocalizedTextEntry, code: string): Promise<TextFilter> {
		return missingTextFilter(
			entry,
			code,
			entry.area === 'photos' ? { _id: { $in: await this.shownPhotoIds() } } : {},
		);
	}

	async missing(code: string): Promise<Record<WrittenLanguageArea, number>> {
		const counts = Object.fromEntries(WRITTEN_LANGUAGE_AREAS.map((area) => [area, 0])) as Record<
			WrittenLanguageArea,
			number
		>;
		for (const entry of LOCALIZED_TEXT_REGISTRY) {
			if (!entry.area) continue;
			counts[entry.area] += await entry.model.collection.countDocuments(await this.missingFilter(entry, code));
		}
		return counts;
	}

	async missingIds(area: WrittenLanguageArea, code: string): Promise<string[]> {
		const found: string[] = [];
		for (const entry of LOCALIZED_TEXT_REGISTRY.filter((row) => row.area === area)) {
			const field = entry.idField ?? '_id';
			const rows = await entry.model.collection
				.find(await this.missingFilter(entry, code), { projection: { [field]: 1 } })
				.toArray();
			found.push(...rows.map((row) => String(row[field])));
		}
		return found;
	}

	async itemsWithText(code: string): Promise<number> {
		let total = 0;
		for (const entry of LOCALIZED_TEXT_REGISTRY) {
			total += await entry.model.collection.countDocuments(heldTextFilter(entry, code));
		}
		return total + (await this.productsWithAltOverrides(code)).length;
	}

	/** Products whose per-photo alt text overrides hold `code`. */
	private async productsWithAltOverrides(code: string): Promise<{ _id: string; media: Document }[]> {
		const rows = await ProductModel.find({ 'media.altOverrides': { $exists: true, $ne: {} } }, { media: 1 })
			.lean<{ _id: string; media: Document }[]>()
			.exec();
		return rows.filter((row) =>
			Object.values((row.media?.altOverrides ?? {}) as Record<string, Document>).some(
				(alt) => alt && typeof alt === 'object' && code in alt,
			),
		);
	}

	async erase(code: string): Promise<number> {
		let changed = 0;
		for (const entry of LOCALIZED_TEXT_REGISTRY) {
			const held = heldTextFilter(entry, code);
			changed += await entry.model.collection.countDocuments(held);
			const flat = Object.fromEntries(
				Object.entries(eraseUpdate(entry, code)).filter(([path]) => !path.includes('.$[].')),
			);
			if (Object.keys(flat).length) await entry.model.collection.updateMany(held, { $unset: flat });
			// Array fields are rewritten item by item: `$[]` refuses documents whose array is missing.
			const arrays = entry.fields.filter((field) => field.path.includes('.$[].'));
			if (!arrays.length) continue;
			const roots = [...new Set(arrays.map((field) => field.path.split('.$[].')[0] as string))];
			const cursor = entry.model.collection.find(held, {
				projection: Object.fromEntries(roots.map((root) => [root, 1])),
			});
			for await (const doc of cursor) {
				const set: Document = {};
				for (const root of roots) {
					const steps = arrays
						.filter((field) => field.path.startsWith(`${root}.$[].`))
						.map((field) => field.path.split('.$[].').slice(1).join('.').split('.'));
					const value = doc[root];
					if (steps.map((path) => stripPath(value, path, code)).some(Boolean)) set[root] = value;
				}
				if (Object.keys(set).length) await entry.model.collection.updateOne({ _id: doc._id }, { $set: set });
			}
		}
		for (const product of await this.productsWithAltOverrides(code)) {
			const overrides = { ...((product.media.altOverrides ?? {}) as Record<string, Document>) };
			for (const alt of Object.values(overrides)) if (alt && typeof alt === 'object') delete alt[code];
			await ProductModel.updateOne({ _id: product._id }, { $set: { 'media.altOverrides': overrides } }).exec();
			changed += 1;
		}
		return changed;
	}
}
