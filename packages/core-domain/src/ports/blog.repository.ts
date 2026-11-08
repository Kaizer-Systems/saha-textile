import type { BlogCategory, BlogPost, BlogStatus, BlogTag } from '@saha-textile/contracts';

import type { Paginated } from './pagination';

export interface BlogPostFilter {
	status?: BlogStatus;
	/** Matches the English title or the address. */
	search?: string;
	/** Only posts on the shop at this moment: live, published on or before it. */
	visibleAt?: string;
	categoryId?: string;
	tagId?: string;
	page: number;
	pageSize: number;
}

/** Blog posts (`blogPosts`). Lists come sticky first, then newest. */
export interface BlogPostRepository {
	findById(id: string): Promise<BlogPost | null>;
	findBySlug(slug: string): Promise<BlogPost | null>;
	list(filter: BlogPostFilter): Promise<Paginated<BlogPost>>;
	/** Live post counts per category and per tag, for the sidebar. */
	countVisibleByTerm(now: string): Promise<{ categories: Record<string, number>; tags: Record<string, number> }>;
	save(post: BlogPost): Promise<BlogPost>;
	remove(id: string): Promise<void>;
	/** Takes a category or tag off every post, when it is deleted. */
	detachTerm(kind: 'category' | 'tag', id: string): Promise<void>;
}

/** Blog categories (`blogCategories`) and blog tags (`blogTags`). */
export interface BlogTermRepository<T extends BlogCategory | BlogTag> {
	list(): Promise<T[]>;
	findById(id: string): Promise<T | null>;
	findBySlug(slug: string): Promise<T | null>;
	findManyByIds(ids: readonly string[]): Promise<T[]>;
	save(term: T): Promise<T>;
	remove(id: string): Promise<void>;
}

export type BlogCategoryRepository = BlogTermRepository<BlogCategory>;
export type BlogTagRepository = BlogTermRepository<BlogTag>;
