import type { ShopEvent, ShopEventStatus, ShopEventType } from '@saha-textile/contracts';

import type { Paginated } from './pagination';

export interface ShopEventFilter {
	type?: ShopEventType;
	status?: ShopEventStatus;
	/** Every word must appear in the name or the English title. Letter case is ignored. */
	search?: string;
	page: number;
	pageSize: number;
}

/** Launch and sale events (`shopEvents`). Lists come soonest start first, drafts last. */
export interface ShopEventRepository {
	findById(id: string): Promise<ShopEvent | null>;
	list(filter: ShopEventFilter): Promise<Paginated<ShopEvent>>;
	/** Scheduled and live events: what the shop, the sale prices and the clock read. */
	listPublished(): Promise<ShopEvent[]>;
	save(event: ShopEvent): Promise<ShopEvent>;
	/**
	 * Moves an event on only if it is still in `from`, so two servers acting on the same
	 * moment can't both run it. Returns the new event, or null when another got there first.
	 */
	transition(id: string, from: ShopEventStatus, patch: Partial<ShopEvent>): Promise<ShopEvent | null>;
	remove(id: string): Promise<void>;
}
