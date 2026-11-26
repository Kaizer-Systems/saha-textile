import { Inject, Injectable } from '@nestjs/common';
import { StorefrontSearchSettings } from '@saha-textile/contracts';
import {
	searchVocabulary,
	type CategoryRepository,
	type SearchTermRepository,
	type SearchVocabulary,
	type SiteSettingsRepository,
} from '@saha-textile/core-domain';

import { CATEGORY_REPOSITORY, SEARCH_TERM_REPOSITORY, SITE_SETTINGS_REPOSITORY } from '../infra/tokens';

/**
 * The live search words, the "show first" categories and the category tree, read once and kept
 * until a search word, the Storefront settings or a category changes. Every index write reads it,
 * so a product save and a full re-index describe a product the same way.
 */
@Injectable()
export class SearchVocabularyService {
	private cached: Promise<SearchVocabulary> | null = null;

	constructor(
		@Inject(SEARCH_TERM_REPOSITORY) private readonly terms: SearchTermRepository,
		@Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository,
		@Inject(SITE_SETTINGS_REPOSITORY) private readonly settings: SiteSettingsRepository,
	) {}

	current(): Promise<SearchVocabulary> {
		this.cached ??= this.load().catch((error: unknown) => {
			this.cached = null;
			throw error;
		});
		return this.cached;
	}

	/** Called after any save that changes what a product is found by. */
	invalidate(): void {
		this.cached = null;
	}

	async showFirstSettings(): Promise<StorefrontSearchSettings> {
		return StorefrontSearchSettings.parse((await this.settings.get('storefront.search')) ?? {});
	}

	private async load(): Promise<SearchVocabulary> {
		const [terms, tree, settings] = await Promise.all([
			this.terms.listLive(),
			this.categories.tree(),
			this.showFirstSettings(),
		]);
		return searchVocabulary(terms, tree, settings.showFirstCategoryIds);
	}
}
