import type {
	BuilderPage,
	LayoutRevision,
	PageLayout,
	PageSection,
	PageTypeKey,
	SavedBlock,
	ScheduleEntry,
} from '@saha-textile/contracts';

/**
 * Page Builder storage (brief PG-4, FX-11): one store for every page type. Layouts belong to a page and target;
 * their content is append-only revisions (never changed once written), and "draft", "live" and "scheduled" are
 * pointers. The page holds its schedule. Nothing here knows which page type it serves.
 */
export interface PageLayoutRepository {
	page(pageType: PageTypeKey, target: string): Promise<BuilderPage | null>;
	layouts(pageType: PageTypeKey, target: string): Promise<PageLayout[]>;
	layout(id: string): Promise<PageLayout | null>;
	revision(id: string): Promise<LayoutRevision | null>;
	/** A layout's revisions, newest first. */
	revisions(layoutId: string, limit: number): Promise<LayoutRevision[]>;

	createLayout(layout: PageLayout): Promise<void>;
	/** Name and template only; revisions and pointers change through their own calls. */
	renameLayout(id: string, name: string, template: string | null, by: string | null, at: string): Promise<void>;
	/**
	 * Writes the next revision of a layout and points its draft at it. `expectedDraftId` guards against a save over
	 * a newer revision (another admin, another tab): null when the layout has no draft yet. Answers null when the
	 * draft moved on, so the caller can refuse with who saved and when.
	 */
	saveDraft(input: {
		layoutId: string;
		sections: PageSection[];
		expectedDraftId: string | null;
		by: string | null;
		at: string;
	}): Promise<LayoutRevision | null>;
	/**
	 * Go Live: the schedule gains the entry and the revision is marked as gone live, in one transaction with
	 * whatever else must change with it (Media use counts), so a Go Live never half-happens.
	 */
	goLive(input: { pageType: PageTypeKey; target: string; entry: ScheduleEntry; at: string }): Promise<void>;
	/** Replaces a page's schedule (cancelling or moving a switch). */
	setSchedule(pageType: PageTypeKey, target: string, schedule: ScheduleEntry[], at: string): Promise<void>;
	/** Keeps the last `keepGoLive` revisions that went live per layout, and drafts newer than `draftsAfter` (Q12). */
	prune(input: { keepGoLive: number; draftsAfter: string }): Promise<number>;
}

/** Saved blocks (SG-5): a section kept on its own, copied into layouts or linked. */
export interface SavedBlockRepository {
	list(): Promise<SavedBlock[]>;
	find(id: string): Promise<SavedBlock | null>;
	save(block: SavedBlock): Promise<void>;
	remove(id: string): Promise<void>;
}
