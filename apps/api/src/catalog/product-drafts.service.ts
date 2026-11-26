import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	ForbiddenException,
	Inject,
	Injectable,
	NotFoundException,
	Optional,
} from '@nestjs/common';
import {
	ProductDraft,
	ProductDraftList,
	type Product,
	type ProductDraftListQuery,
	type ProductDraftWrite,
} from '@saha-textile/contracts';
import type { AdminUserRepository, ProductDraftRepository, ProductRepository } from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { ADMIN_USER_REPOSITORY, PRODUCT_DRAFT_REPOSITORY, PRODUCT_REPOSITORY } from '../infra/tokens';
import { CatalogService } from './catalog.service';

/** The right a draft of each kind needs: adding products, or editing them. */
const RIGHT = { new: 'product.create', edit: 'product.edit' } as const;

/**
 * Product drafts (product bulk actions brief § 7): Save as draft keeps the product form as it is, with
 * no checks, apart from the product itself. Anyone with the right can open the team's drafts, so a
 * colleague can finish them; each save and discard is in the activity log.
 */
@Injectable()
export class ProductDraftsService {
	constructor(
		@Inject(PRODUCT_DRAFT_REPOSITORY) private readonly drafts: ProductDraftRepository,
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		private readonly catalog: CatalogService,
		@Optional() @Inject(ADMIN_USER_REPOSITORY) private readonly admins: AdminUserRepository | null = null,
	) {}

	async list(query: ProductDraftListQuery, principal: AuthenticatedPrincipal): Promise<ProductDraftList> {
		const page = await this.drafts.list({
			...(query.scope === 'mine' ? { createdBy: principal.userId } : {}),
			...(query.productId ? { productId: query.productId } : {}),
			...(query.search ? { search: query.search } : {}),
			page: query.page,
			pageSize: query.pageSize,
		});
		const products = new Map<string, Product | null>();
		for (const draft of page.items) {
			if (draft.productId && !products.has(draft.productId)) {
				products.set(draft.productId, await this.products.findById(draft.productId, 'admin'));
			}
		}
		const pictureOf = (draft: ProductDraft): string | null =>
			draft.imageAssetId ?? (draft.productId ? (products.get(draft.productId)?.media.gallery[0] ?? null) : null);
		const pictures = await this.catalog.thumbnailsFor(page.items.map(pictureOf).filter((id): id is string => !!id));
		const names = new Map<string, string | null>();
		for (const id of new Set(page.items.map((draft) => draft.updatedBy).filter((id): id is string => !!id))) {
			const admin = await this.admins?.findById(id);
			names.set(id, admin?.displayName || admin?.username || admin?.email || null);
		}
		return ProductDraftList.parse({
			items: page.items.map((draft) => {
				// Every draft's product was read above, as itself or as null.
				const product = draft.productId ? (products.get(draft.productId) as Product | null) : null;
				const picture = pictureOf(draft);
				return {
					id: draft.id,
					kind: draft.kind,
					productId: draft.productId,
					title: draft.title,
					thumbnailUrl: picture ? (pictures.get(picture) ?? null) : null,
					productStatus: product?.status ?? null,
					productTitle: product ? product.title['en'] || product.sku : null,
					productWasLive: !!product && (product.status === 'live' || product.lifecycle.liveAt !== null),
					changedCount: draft.changes.length,
					toFix: draft.toFix,
					updatedAt: draft.updatedAt,
					updatedByName: draft.updatedBy ? (names.get(draft.updatedBy) ?? null) : null,
					mine: draft.createdBy === principal.userId,
				};
			}),
			total: page.total,
			mine: await this.drafts.countBy(principal.userId),
			page: page.page,
			pageSize: page.pageSize,
		});
	}

	async get(id: string): Promise<ProductDraft> {
		const draft = await this.drafts.findById(id);
		if (!draft) throw new NotFoundException('Draft not found');
		return draft;
	}

	/**
	 * Saves a draft as it is, without any check of its fields. A draft of changes is one per product
	 * per person: saving again updates it. The product itself is never touched here.
	 */
	async save(id: string | null, body: ProductDraftWrite, principal: AuthenticatedPrincipal): Promise<ProductDraft> {
		this.allow(body.kind, principal);
		const existing = id
			? await this.get(id)
			: body.kind === 'edit' && body.productId
				? await this.drafts.findEdit(body.productId, principal.userId)
				: null;
		if (existing && (existing.kind !== body.kind || existing.productId !== body.productId)) {
			throw new BadRequestException('A draft keeps its kind and its product');
		}
		if (body.kind === 'edit' && body.productId) {
			const product = await this.products.findById(body.productId, 'admin');
			if (!product) throw new NotFoundException('Product not found');
			if (product.status === 'discontinued') {
				throw new BadRequestException('A discontinued product cannot be changed');
			}
		}
		const now = new Date().toISOString();
		const saved = await this.drafts.save(
			ProductDraft.parse({
				id: existing?.id ?? `pdr_${randomUUID()}`,
				kind: body.kind,
				productId: body.productId,
				title: body.title,
				imageAssetId: body.imageAssetId,
				form: body.form,
				changes: body.changes,
				toFix: body.toFix,
				// A draft of changes keeps the moment it began, so a later save by someone else is noticed.
				baseSavedAt: existing?.baseSavedAt ?? body.baseSavedAt,
				createdBy: existing?.createdBy ?? principal.userId,
				updatedBy: principal.userId,
				createdAt: existing?.createdAt ?? now,
				updatedAt: now,
			}),
		);
		await this.catalog.record(principal.userId, 'catalog.product-draft.save', saved.id, {
			kind: saved.kind,
			productId: saved.productId,
			changed: saved.changes.length,
		});
		return saved;
	}

	/** Discard: the draft only; the product stays exactly as it is. */
	async remove(id: string, principal: AuthenticatedPrincipal): Promise<void> {
		const draft = await this.get(id);
		this.allow(draft.kind, principal);
		await this.drafts.remove(id);
		await this.catalog.record(principal.userId, 'catalog.product-draft.discard', id, {
			kind: draft.kind,
			productId: draft.productId,
		});
	}

	private allow(kind: ProductDraft['kind'], principal: AuthenticatedPrincipal) {
		if (!principal.permissions.includes(RIGHT[kind])) throw new ForbiddenException('Insufficient permissions');
	}
}
