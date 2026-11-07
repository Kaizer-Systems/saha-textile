import { describe, expect, it } from 'vitest';
import type { Schema } from 'mongoose';

import * as models from '../src/models/index';
import { MEDIA_OWNER_REGISTRY } from '../src/repositories/media-owner-registry';

/**
 * The schema walker behind the `countReferences` fix (owner lock 2026-08-23).
 *
 * GC deletes an asset only when every registered owner reports zero references, so an
 * unregistered owner is a latent data-loss bug. Rather than trusting anyone to remember,
 * this walks every model and fails when a field that looks like a media reference — any
 * path ending in `AssetId`/`AssetIds`, or a free-form `media` sub-document — has no
 * registry entry on that model.
 */
/** The part of a Mongoose model the walk reads; the export union is too wide to narrow to `Model`. */
interface WalkableModel {
	modelName: string;
	collection: { collectionName: string };
	schema: Schema;
}

const exportedModels = (Object.values(models) as unknown[]).filter(
	(value): value is WalkableModel => typeof value === 'function' && 'modelName' in value && 'schema' in value,
);

/** Collections that store media ids as their OWN identity, not as a reference. */
const NOT_OWNERS = new Set(['mediaAssets', 'mediaRoles']);

const registeredPaths = (model: WalkableModel): string[] =>
	MEDIA_OWNER_REGISTRY.filter((entry) => entry.model.modelName === model.modelName).map((entry) => entry.path);

const referencePaths = (schema: Schema): string[] => {
	const found: string[] = [];
	schema.eachPath((path, type) => {
		const leaf = path.split('.').at(-1) ?? path;
		if (/AssetIds?$/.test(leaf)) found.push(path);
		if (leaf === 'media' && type.instance === 'Mixed') found.push(`${path}.*`);
	});
	return found;
};

describe('media owner registry', () => {
	it('registers every field that can hold a media asset id', () => {
		const unregistered: string[] = [];
		for (const model of exportedModels) {
			if (NOT_OWNERS.has(model.collection.collectionName)) continue;
			const registered = registeredPaths(model);
			for (const path of referencePaths(model.schema)) {
				const covered = path.endsWith('.*')
					? registered.some((entry) => entry.startsWith(path.slice(0, -1)))
					: registered.includes(path);
				if (!covered) unregistered.push(`${model.modelName}.${path}`);
			}
		}
		expect(unregistered).toEqual([]);
	});

	it('only names models that exist and paths that are non-empty', () => {
		const names = new Set(exportedModels.map((model) => model.modelName));
		for (const entry of MEDIA_OWNER_REGISTRY) {
			expect(names.has(entry.model.modelName)).toBe(true);
			expect(entry.path.length).toBeGreaterThan(0);
		}
	});

	it('covers the owners the locks name: products, variants, swatches, categories, reviews, banners', () => {
		const collections = new Set(MEDIA_OWNER_REGISTRY.map((entry) => entry.model.collection.collectionName));
		for (const name of [
			'products',
			'productVariants',
			'attributeDefinitions',
			'categories',
			'reviews',
			'contentBlocks',
		]) {
			expect(collections.has(name)).toBe(true);
		}
	});
});
