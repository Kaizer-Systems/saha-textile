import type { ProductDraft } from '@saha-textile/contracts';

import type { Paginated } from './pagination';

export interface ProductDraftFilter {
	/** Only this admin's drafts (Mine). */
	createdBy?: string;
	/** Only drafts of this product. */
	productId?: string;
	/** Every word must appear in the draft's name. Letter case is ignored. */
	search?: string;
	page: number;
	pageSize: number;
}

/**
 * Product drafts (`productDrafts`): unfinished product-form work, kept apart from products so the
 * shop, search, sitemap, sales and stock never see it. Lists come newest save first.
 */
export interface ProductDraftRepository {
	findById(id: string): Promise<ProductDraft | null>;
	/** This person's draft of changes to this product, if any: there is one per product per person. */
	findEdit(productId: string, createdBy: string | null): Promise<ProductDraft | null>;
	list(filter: ProductDraftFilter): Promise<Paginated<ProductDraft>>;
	/** How many drafts this admin has, for the menu badge. */
	countBy(createdBy: string): Promise<number>;
	save(draft: ProductDraft): Promise<ProductDraft>;
	remove(id: string): Promise<void>;
	/** Every draft of a product goes when the product itself is deleted. */
	removeForProduct(productId: string): Promise<number>;
}
