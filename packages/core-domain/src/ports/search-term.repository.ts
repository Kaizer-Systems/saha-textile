import type { SearchTerm, SearchTermStatus } from '@saha-textile/contracts';

import type { Paginated } from './pagination';

export interface SearchTermFilter {
	/** Every typed word must appear in a name or spelling, any language, any case. */
	search?: string;
	status?: SearchTermStatus;
	page: number;
	pageSize: number;
}

/** Search words (`searchDictionary`). Lists come newest change first. */
export interface SearchTermRepository {
	list(filter: SearchTermFilter): Promise<Paginated<SearchTerm>>;
	listLive(): Promise<SearchTerm[]>;
	findById(id: string): Promise<SearchTerm | null>;
	findManyByIds(ids: readonly string[]): Promise<SearchTerm[]>;
	save(term: SearchTerm): Promise<SearchTerm>;
	remove(id: string): Promise<void>;
}
