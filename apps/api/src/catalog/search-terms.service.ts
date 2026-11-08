import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
	type AdminSearchTermDetail,
	type AdminSearchTermListQuery,
	type AdminSearchTermListResponse,
	type AuditLog,
	type GoLiveResult,
	type Product,
	SearchTerm,
	type SearchTermStatus,
	type SearchTermWrite,
	StorefrontSearchSettings,
} from '@saha-textile/contracts';
import {
	cleanSpellings,
	searchTermGaps,
	withDescendants,
	type AuditLogRepository,
	type CategoryRepository,
	type ProductRepository,
	type SearchPort,
	type SearchTermRepository,
	type SiteSettingsRepository,
} from '@saha-textile/core-domain';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import {
	AUDIT_LOG_REPOSITORY,
	CATEGORY_REPOSITORY,
	PRODUCT_REPOSITORY,
	SEARCH_PORT,
	SEARCH_TERM_REPOSITORY,
	SITE_SETTINGS_REPOSITORY,
} from '../infra/tokens';
import { CatalogPublicService } from './catalog-public.service';
import { CatalogService } from './catalog.service';
import { SearchVocabularyService } from './search-vocabulary.service';

const PAGE = 200;

/** A Live save that would leave a gap: nothing is saved, and the gaps travel as field issues. */
const gapRefusal = (gaps: GoLiveResult['gaps']): BadRequestException =>
	new BadRequestException({
		message: 'go_live_blocked',
		issues: gaps.map((gap) => ({
			path: [gap.field, gap.locale ?? ''],
			message: 'go_live_blocked',
			code: 'go_live_blocked',
		})),
	});

const cleanText = (values: Readonly<Record<string, string>>): Record<string, string> =>
	Object.fromEntries(
		Object.entries(values)
			.map(([locale, text]): [string, string] => [locale, (text ?? '').replace(/\s+/g, ' ').trim()])
			.filter(([, text]) => text.length > 0),
	);

/**
 * The admin's search words and Storefront settings › Search (owner log § search words,
 * 2026-11-08). Every save is audited, and re-indexes only the products whose words or order it
 * changes, in the background: the admin answers at once, and shoppers keep the old results until
 * the new ones are written.
 */
@Injectable()
export class SearchTermsService {
	private readonly logger = new Logger(SearchTermsService.name);
	/** The latest background re-index, so tests and the next save can wait for it. */
	pending: Promise<void> = Promise.resolve();

	constructor(
		@Inject(SEARCH_TERM_REPOSITORY) private readonly terms: SearchTermRepository,
		@Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository,
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		@Inject(SITE_SETTINGS_REPOSITORY) private readonly settings: SiteSettingsRepository,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
		private readonly catalog: CatalogService,
		private readonly cards: CatalogPublicService,
		private readonly vocabulary: SearchVocabularyService,
		@Optional() @Inject(SEARCH_PORT) private readonly search: SearchPort | null = null,
		@Optional() @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository | null = null,
	) {}

	// ── Search words ───────────────────────────────────────────────────────────

	async list(query: AdminSearchTermListQuery): Promise<AdminSearchTermListResponse> {
		return this.terms.list({
			search: query.search,
			status: query.status,
			page: query.page,
			pageSize: query.pageSize,
		});
	}

	async detail(id: string): Promise<AdminSearchTermDetail> {
		const term = await this.requireTerm(id);
		return { term, products: await this.productSummaries(term.productIds) };
	}

	async save(id: string | null, body: SearchTermWrite, actorUserId: string | null): Promise<{ id: string }> {
		const existing = id ? await this.requireTerm(id) : null;
		const name = cleanText(body.name);
		if (!name['en']) throw new BadRequestException('A name in English is required');
		await this.requireTags(body.categoryIds, body.productIds);
		const term = SearchTerm.parse({
			id: existing?.id ?? `sterm_${randomUUID()}`,
			name,
			spellings: cleanSpellings(body.spellings, name),
			categoryIds: [...new Set(body.categoryIds)],
			productIds: [...new Set(body.productIds)],
			status: body.status,
		});
		if (term.status === 'live') {
			const gaps = searchTermGaps(term, this.config.locales);
			if (gaps.length) throw gapRefusal(gaps);
		}
		await this.terms.save(term);
		await this.record(actorUserId, 'catalog.search_term.save', term.id, {
			name: term.name['en'],
			status: term.status,
		});
		this.refresh([existing, term]);
		return { id: term.id };
	}

	/** The list's bulk switch. Each word that cannot go live comes back with its gaps; the rest change. */
	async setStatus(
		ids: readonly string[],
		status: SearchTermStatus,
		actorUserId: string | null,
	): Promise<{ updated: string[]; refused: Array<{ id: string; gaps: GoLiveResult['gaps'] }> }> {
		const found = await this.terms.findManyByIds(ids);
		const updated: SearchTerm[] = [];
		const refused: Array<{ id: string; gaps: GoLiveResult['gaps'] }> = [];
		for (const term of found) {
			if (term.status === status) continue;
			const gaps = status === 'live' ? searchTermGaps(term, this.config.locales) : [];
			if (gaps.length) {
				refused.push({ id: term.id, gaps });
				continue;
			}
			await this.terms.save({ ...term, status });
			await this.record(actorUserId, 'catalog.search_term.status', term.id, { status });
			updated.push(term);
		}
		if (updated.length) this.refresh(updated);
		return { updated: updated.map((term) => term.id), refused };
	}

	async remove(id: string, actorUserId: string | null): Promise<void> {
		const term = await this.requireTerm(id);
		await this.terms.remove(id);
		await this.record(actorUserId, 'catalog.search_term.delete', id, { name: term.name['en'] });
		this.refresh([term]);
	}

	// ── Storefront settings › Search ───────────────────────────────────────────

	getSearchSettings(): Promise<StorefrontSearchSettings> {
		return this.vocabulary.showFirstSettings();
	}

	async saveSearchSettings(
		body: StorefrontSearchSettings,
		actorUserId: string | null,
	): Promise<StorefrontSearchSettings> {
		await this.requireTags(body.showFirstCategoryIds, []);
		const settings = StorefrontSearchSettings.parse({
			showFirstCategoryIds: [...new Set(body.showFirstCategoryIds)],
		});
		await this.settings.set('storefront.search', settings);
		await this.record(actorUserId, 'storefront.settings.search', 'storefront.search', settings);
		this.vocabulary.invalidate();
		// The order of every product can change, so the whole shop is re-written in place.
		this.pending = this.pending.then(() => this.reindexAll()).catch((error: unknown) => this.failed(error));
		return settings;
	}

	// ── Index upkeep ───────────────────────────────────────────────────────────

	/** New synonyms at once; the products a word tags, before or after, re-written in the background. */
	private refresh(versions: ReadonlyArray<SearchTerm | null>): void {
		this.vocabulary.invalidate();
		const changed = versions.filter((term): term is SearchTerm => term !== null);
		this.pending = this.pending
			.then(async () => {
				await this.search?.updateSynonyms((await this.vocabulary.current()).synonyms);
				await this.reindex(
					changed.flatMap((term) => term.categoryIds),
					changed.flatMap((term) => term.productIds),
				);
			})
			.catch((error: unknown) => this.failed(error));
	}

	private async reindex(categoryIds: readonly string[], productIds: readonly string[]): Promise<void> {
		const byId = new Map<string, Product>();
		if (categoryIds.length) {
			const all = withDescendants(categoryIds, await this.categories.tree());
			for (const product of await this.listProducts(all)) byId.set(product.id, product);
		}
		for (const id of productIds) {
			if (byId.has(id)) continue;
			const product = await this.products.findById(id, 'public');
			if (product) byId.set(id, product);
		}
		await this.catalog.syncSearchMany([...byId.values()]);
	}

	private async reindexAll(): Promise<void> {
		await this.search?.updateSynonyms((await this.vocabulary.current()).synonyms);
		await this.catalog.syncSearchMany(await this.listProducts(null));
	}

	private async listProducts(categoryIds: readonly string[] | null): Promise<Product[]> {
		const found: Product[] = [];
		for (let page = 1; ; page += 1) {
			const { items, total } = await this.products.list({
				audience: 'public',
				page,
				pageSize: PAGE,
				...(categoryIds ? { categoryIds: [...categoryIds] } : {}),
			});
			found.push(...items);
			if (!items.length || found.length >= total) return found;
		}
	}

	private failed(error: unknown): void {
		this.logger.warn(`Search index not refreshed after a search word change: ${String(error)}`);
	}

	// ── Helpers ────────────────────────────────────────────────────────────────

	private async requireTerm(id: string): Promise<SearchTerm> {
		const term = await this.terms.findById(id);
		if (!term) throw new NotFoundException('No such search word');
		return term;
	}

	private async requireTags(categoryIds: readonly string[], productIds: readonly string[]): Promise<void> {
		if (categoryIds.length) {
			const known = new Set((await this.categories.tree()).map((row) => row.id));
			if (categoryIds.some((id) => !known.has(id))) throw new BadRequestException('Unknown category');
		}
		for (const id of new Set(productIds)) {
			if (!(await this.products.findById(id, 'admin'))) throw new BadRequestException('Unknown product');
		}
	}

	private async productSummaries(ids: readonly string[]): Promise<AdminSearchTermDetail['products']> {
		const cards = new Map((await this.cards.cardsForIds(ids)).map((card) => [card.id, card]));
		const rows: AdminSearchTermDetail['products'] = [];
		for (const id of ids) {
			const card = cards.get(id);
			if (card) {
				rows.push({ id, name: card.title, image: card.image?.roles['card']?.[0]?.url ?? null });
				continue;
			}
			const product = await this.products.findById(id, 'admin');
			if (product) rows.push({ id, name: product.title['en'] ?? id, image: null });
		}
		return rows;
	}

	private async record(
		actorUserId: string | null,
		action: string,
		entityId: string,
		metadata: Record<string, unknown>,
	) {
		if (!this.audit) return;
		const entry: AuditLog = {
			id: `audit_${randomUUID()}`,
			actorUserId,
			targetUserId: null,
			audience: 'admin',
			action,
			entityType: 'search_term',
			entityId,
			severity: 'info',
			retentionTier: 'catalog_admin',
			diffs: [],
			metadata,
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		};
		await this.audit.append(entry);
	}
}
