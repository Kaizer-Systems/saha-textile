import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
	AdminCategoryRow,
	AttributeDefinition,
	Category,
	CategoryPlacement,
	type AdminAttributeWrite,
	type AdminCategoryWrite,
	type Product,
} from '@saha-textile/contracts';
import type {
	AttributeDefinitionRepository,
	CategoryPlacementRepository,
	CategoryRepository,
	ProductRepository,
} from '@saha-textile/core-domain';

import { CatalogPublicService } from './catalog-public.service';
import { CatalogService } from './catalog.service';
import {
	ATTRIBUTE_DEFINITION_REPOSITORY,
	CATEGORY_PLACEMENT_REPOSITORY,
	CATEGORY_REPOSITORY,
	PRODUCT_REPOSITORY,
} from '../infra/tokens';

const collectionPath = (placement: CategoryPlacement): string => `/collections/${placement.pathSlugs.join('/')}`;

/** Undefined leaves an image alone, and null clears it. */
function imageChange(key: 'bannerImage' | 'iconImage', id: string | null | undefined, existing: Category | null) {
	const kept = id === undefined ? existing?.media?.[key] : (id ?? undefined);
	return { [key]: kept };
}

/** Categories and attributes: the helpers the product form picks from. */
@Injectable()
export class TaxonomyService {
	constructor(
		private readonly catalog: CatalogService,
		@Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository,
		@Inject(CATEGORY_PLACEMENT_REPOSITORY) private readonly placements: CategoryPlacementRepository,
		@Inject(ATTRIBUTE_DEFINITION_REPOSITORY) private readonly attributes: AttributeDefinitionRepository,
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		private readonly publicCatalog: CatalogPublicService,
	) {}

	async listCategories(): Promise<AdminCategoryRow[]> {
		const categories = await this.categories.tree();
		const images = await this.publicCatalog.categoryImages(
			categories.flatMap((category) => [category.media?.bannerImage ?? [], category.media?.iconImage ?? []].flat()),
		);
		return Promise.all(categories.map((category) => this.categoryRow(category, images)));
	}

	private async categoryRow(category: Category, images: ReadonlyMap<string, string>): Promise<AdminCategoryRow> {
		const shown = (id: string | undefined) => {
			const url = id ? images.get(id) : undefined;
			return id && url ? { id, url } : null;
		};
		const placements = await this.placements.listForCategory(category.id);
		const canonical = placements.find((row) => row.isCanonical) ?? null;
		const { total } = await this.products.list({
			audience: 'admin',
			categoryId: category.id,
			page: 1,
			pageSize: 1,
		});
		return AdminCategoryRow.parse({
			id: category.id,
			name: category.name,
			description: category.description,
			seoTitle: category.seo?.title ?? {},
			seoDescription: category.seo?.description ?? {},
			slug: category.slug,
			parentId: category.parentId,
			alsoUnder: placements.flatMap((row) =>
				!row.isCanonical && row.parentCategoryId ? [row.parentCategoryId] : [],
			),
			path: canonical ? canonical.pathSlugs.join('/') : null,
			productCount: total,
			image: shown(category.media?.bannerImage),
			icon: shown(category.media?.iconImage),
		});
	}

	async saveCategory(id: string | null, body: AdminCategoryWrite, actorUserId: string | null) {
		if (!body.name['en']?.trim()) throw new BadRequestException('A category needs an English name');
		const existing = id ? await this.categories.findById(id) : null;
		if (id && !existing) throw new NotFoundException(`Category not found: ${id}`);
		const taken = await this.categories.findBySlug(body.slug);
		if (taken && taken.id !== id) throw new BadRequestException('That address is already taken');
		const parent = body.parentId ? await this.categories.findById(body.parentId) : null;
		if (body.parentId && !parent) throw new BadRequestException('The parent category does not exist');
		const categoryId = id ?? `cat_${randomUUID()}`;
		if (body.parentId === categoryId || parent?.ancestors.includes(categoryId)) {
			throw new BadRequestException('A category may never sit under itself');
		}
		const ancestors = parent ? [...parent.ancestors, parent.id] : [];
		const category = Category.parse({
			...existing,
			id: categoryId,
			name: { ...body.name, en: body.name['en'] },
			slug: body.slug,
			parentId: body.parentId,
			ancestors,
			path: [...ancestors, categoryId],
			depth: ancestors.length,
			displayOrder: body.displayOrder ?? existing?.displayOrder ?? 0,
			description: body.description,
			seo: { title: body.seoTitle, description: body.seoDescription },
			media: {
				...existing?.media,
				...imageChange('bannerImage', body.imageId, existing),
				...imageChange('iconImage', body.iconId, existing),
			},
		});
		const current = await this.placements.findCanonical(categoryId);
		const oldPaths = current ? await this.subtreePaths(current.id) : new Map<string, string>();
		await this.catalog.inTransaction(async () => {
			await this.categories.save(category);
			await this.syncPlacements(category, existing, body.alsoUnder);
		});
		await this.forwardMovedPaths(category, oldPaths);
		await this.catalog.record(actorUserId, 'catalog.category.save', categoryId, { slug: body.slug });
		return { id: categoryId };
	}

	private async syncPlacements(category: Category, before: Category | null, alsoUnder: readonly string[]) {
		const canonical = await this.placements.findCanonical(category.id);
		if (!canonical) {
			await this.placements.save(await this.newPlacement(category, category.parentId, true));
		} else {
			if (before?.parentId !== category.parentId) {
				await this.placements.moveSubtree({
					placementId: canonical.id,
					newParentCategoryId: category.parentId,
				});
			}
			if (before?.slug !== category.slug) await this.renameInPaths(category, canonical.id);
		}
		const current = (await this.placements.listForCategory(category.id)).filter((row) => !row.isCanonical);
		for (const row of current) {
			if (!alsoUnder.includes(row.parentCategoryId as string)) await this.placements.deleteById(row.id);
		}
		const held = new Set(current.map((row) => row.parentCategoryId));
		for (const parentId of alsoUnder) {
			if (!held.has(parentId)) await this.placements.save(await this.newPlacement(category, parentId, false));
		}
	}

	/** Runs after the save commits, so it reads the new paths. */
	private async forwardMovedPaths(category: Category, oldPaths: ReadonlyMap<string, string>) {
		for (const [placementId, oldPath] of oldPaths) {
			const moved = await this.placements.findById(placementId);
			const nextPath = moved ? collectionPath(moved) : oldPath;
			if (nextPath !== oldPath) {
				await this.catalog.upsertRedirect({
					sourcePath: oldPath,
					statusCode: 301,
					targetPath: nextPath,
					reason: 'category_move',
					entityType: 'category',
					entityId: category.id,
				});
			}
		}
	}

	private async subtreePaths(placementId: string): Promise<Map<string, string>> {
		const rows = await this.placements.listSubtree(placementId, 'admin');
		return new Map(rows.map((row) => [row.id, collectionPath(row)]));
	}

	private async renameInPaths(category: Category, placementId: string) {
		for (const row of await this.placements.listSubtree(placementId, 'admin')) {
			const index = row.pathCategoryIds.indexOf(category.id);
			const pathSlugs = row.pathSlugs.map((slug, position) => (position === index ? category.slug : slug));
			await this.placements.save({ ...row, pathSlugs });
		}
	}

	private async newPlacement(category: Category, parentId: string | null, isCanonical: boolean) {
		const parent = parentId ? await this.placements.findCanonical(parentId) : null;
		if (parentId && !parent) throw new BadRequestException('The parent category has no address yet');
		const name = category.name.en;
		return CategoryPlacement.parse({
			id: `plc_${randomUUID()}`,
			categoryId: category.id,
			parentCategoryId: parentId,
			pathCategoryIds: [...(parent?.pathCategoryIds ?? []), category.id],
			pathSlugs: [...(parent?.pathSlugs ?? []), category.slug],
			pathLabel: parent ? `${parent.pathLabel} / ${name}` : name,
			depth: parent ? parent.depth + 1 : 0,
			isCanonical,
			displayOrder: category.displayOrder,
			status: 'live',
		});
	}

	async deleteCategory(id: string, actorUserId: string | null) {
		const row = await this.categories.findById(id);
		if (!row) throw new NotFoundException(`Category not found: ${id}`);
		if ((await this.categories.listChildren(id)).length) {
			throw new BadRequestException('Move or delete its child categories first');
		}
		const { total } = await this.products.list({ audience: 'admin', categoryId: id, page: 1, pageSize: 1 });
		if (total > 0) throw new BadRequestException('Move its products to another category first');
		for (const placement of await this.placements.listForCategory(id)) {
			await this.placements.deleteById(placement.id);
		}
		await this.categories.deleteById(id);
		await this.catalog.record(actorUserId, 'catalog.category.delete', id, { slug: row.slug });
	}

	listAttributes(): Promise<AttributeDefinition[]> {
		return this.attributes.listAll();
	}

	async saveAttribute(body: AdminAttributeWrite, actorUserId: string | null) {
		if (!body.label['en']?.trim()) throw new BadRequestException('An attribute needs an English name');
		const existing = await this.attributes.findByCode(body.code);
		const used = await this.usedTerms(body.code);
		const kept = new Set(body.terms.map((term) => term.code));
		const removed = [...used].filter((code) => !kept.has(code));
		if (removed.length) {
			throw new BadRequestException(
				`These values are used by a product, so hide them instead: ${removed.join(', ')}`,
			);
		}
		const saved = await this.attributes.save(
			AttributeDefinition.parse({ ...body, id: existing?.id ?? `attr_${body.code}` }),
		);
		await this.copyToProducts(saved);
		await this.catalog.record(actorUserId, 'catalog.attribute.save', saved.id, { code: saved.code });
		return saved;
	}

	/**
	 * A product holds its own copy of each value's name, so a new name or translation is written
	 * to every product using it, then to search. A shop this size does it in the request; a very
	 * large catalogue would move this one loop onto the job queue.
	 */
	private async copyToProducts(definition: AttributeDefinition): Promise<void> {
		const terms = new Map(definition.terms.map((term) => [term.code, term]));
		for (const product of await this.productsUsing(definition.code)) {
			const optionGroups = product.optionGroups.map((group) =>
				group.attributeCode === definition.code
					? {
							...group,
							label: definition.label,
							terms: group.terms.map((term) => ({ ...term, label: terms.get(term.code)?.label ?? term.label })),
						}
					: group,
			);
			const next = { ...product, optionGroups };
			await this.products.save(next);
			await this.catalog.syncSearch(next);
		}
	}

	async deleteAttribute(code: string, actorUserId: string | null) {
		if (!(await this.attributes.findByCode(code))) throw new NotFoundException(`Attribute not found: ${code}`);
		if ((await this.usedTerms(code)).size) {
			throw new BadRequestException('A product uses this attribute, so it cannot be deleted');
		}
		await this.attributes.deleteByCode(code);
		await this.catalog.record(actorUserId, 'catalog.attribute.delete', code, { code });
	}

	/** Term codes any product uses for an attribute. */
	private async usedTerms(code: string): Promise<Set<string>> {
		const groups = (await this.productsUsing(code)).flatMap((product) => product.optionGroups);
		return new Set(
			groups.filter((group) => group.attributeCode === code).flatMap((group) => group.terms.map((term) => term.code)),
		);
	}

	private async productsUsing(code: string): Promise<Product[]> {
		const found: Product[] = [];
		for (let page = 1; ; page += 1) {
			const { items, total } = await this.products.list({ audience: 'admin', page, pageSize: 200 });
			found.push(...items.filter((row) => row.optionGroups.some((group) => group.attributeCode === code)));
			if (!items.length || page * 200 >= total) return found;
		}
	}
}
