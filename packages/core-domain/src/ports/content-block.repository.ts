import type { ContentBlock } from '@saha-textile/contracts';

export interface ContentBlockFilter {
	ownerType?: ContentBlock['ownerType'];
	ownerId?: string | null;
	position?: ContentBlock['position'];
	status?: ContentBlock['status'];
}

/** Banners and editorial blocks (`contentBlocks`), keyed by position and slot. */
export interface ContentBlockRepository {
	findByKey(key: string): Promise<ContentBlock | null>;
	list(filter: ContentBlockFilter): Promise<ContentBlock[]>;
	/** Active blocks for an owner whose schedule includes `now`. */
	listLive(input: {
		ownerType: ContentBlock['ownerType'];
		ownerId: string | null;
		now: string;
	}): Promise<ContentBlock[]>;
	save(block: ContentBlock): Promise<ContentBlock>;
	deleteByKey(key: string): Promise<void>;
}
