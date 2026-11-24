import { randomUUID } from 'node:crypto';

import {
	EMPTY_PAGE_SETTINGS,
	PageSettings,
	PendingGoLive,
	type BuilderPage,
	type LayoutRevision,
	type PageLayout,
	type PageSection,
	type PageTypeKey,
	type SavedBlock,
	type ScheduleEntry,
} from '@saha-textile/contracts';
import type {
	HeldLock,
	PageLayoutRepository,
	PreviewTokenRepository,
	SavedBlockRepository,
} from '@saha-textile/core-domain';

import {
	BuilderPageModel,
	PageLayoutModel,
	PageLayoutRevisionModel,
	SavedBlockModel,
	type BuilderPageDoc,
	type LayoutRevisionDoc,
	type PageLayoutDoc,
	type SavedBlockDoc,
} from '../models/index';

/** Every photo a section shows: each piece's pictures in every band, and their art per language. */
export function sectionAssetIds(sections: readonly PageSection[]): string[] {
	const ids = new Set<string>();
	for (const section of sections) {
		if (!('pieces' in section)) continue;
		for (const piece of section.pieces) {
			for (const picture of piece.pictures) {
				for (const set of [picture.images, ...Object.values(picture.localeImages ?? {})]) {
					for (const id of [set.desktop, set.tablet, set.phone]) if (id) ids.add(id);
				}
			}
		}
	}
	return [...ids];
}

const iso = (date: Date | null | undefined): string | null => (date ? new Date(date).toISOString() : null);
const pageId = (pageType: string, target: string) => `${pageType}:${target}`;

const toEntry = (entry: BuilderPageDoc['schedule'][number]): ScheduleEntry => ({
	revisionId: entry.revisionId,
	layoutId: entry.layoutId,
	from: new Date(entry.from).toISOString(),
	until: iso(entry.until),
	by: entry.by ?? null,
});
const fromEntry = (entry: ScheduleEntry) => ({
	revisionId: entry.revisionId,
	layoutId: entry.layoutId,
	from: new Date(entry.from),
	until: entry.until ? new Date(entry.until) : null,
	by: entry.by ?? null,
});

const toPage = (doc: BuilderPageDoc): BuilderPage => ({
	pageType: doc.pageType as PageTypeKey,
	target: doc.target,
	schedule: (doc.schedule ?? []).map(toEntry),
	settings: PageSettings.parse(doc.settings ?? EMPTY_PAGE_SETTINGS),
	safeMode: doc.safeMode ? { by: doc.safeMode.by ?? null, at: new Date(doc.safeMode.at).toISOString() } : null,
	// Stored as the contract validated them; a row that no longer parses is dropped rather than breaking the page.
	pending: (doc.pending ?? []).flatMap((row) => {
		const parsed = PendingGoLive.safeParse(row);
		return parsed.success ? [parsed.data] : [];
	}),
	updatedAt: new Date(doc.updatedAt).toISOString(),
});

const toLock = (lock: NonNullable<PageLayoutDoc['lock']>): HeldLock => ({
	holder: lock.holder,
	since: new Date(lock.since).toISOString(),
	heartbeatAt: new Date(lock.heartbeatAt).toISOString(),
});

const toLayout = (doc: PageLayoutDoc): PageLayout => ({
	id: doc._id,
	pageType: doc.pageType as PageTypeKey,
	target: doc.target,
	name: doc.name,
	template: doc.template ?? null,
	draftRevisionId: doc.draftRevisionId ?? null,
	lastLiveRevisionId: doc.lastLiveRevisionId ?? null,
	createdAt: new Date(doc.createdAt).toISOString(),
	updatedAt: new Date(doc.updatedAt).toISOString(),
	updatedBy: doc.updatedBy ?? null,
	reviewRequest: doc.reviewRequest
		? {
				by: doc.reviewRequest.by ?? null,
				at: new Date(doc.reviewRequest.at).toISOString(),
				note: doc.reviewRequest.note ?? '',
			}
		: null,
});

const toRevision = (doc: LayoutRevisionDoc): LayoutRevision => ({
	id: doc._id,
	layoutId: doc.layoutId,
	number: doc.number,
	sections: (doc.sections ?? []) as PageSection[],
	createdAt: new Date(doc.createdAt).toISOString(),
	createdBy: doc.createdBy ?? null,
	wentLiveAt: iso(doc.wentLiveAt),
});

/** Page Builder layouts, their append-only revisions and each page's schedule (Page Builder brief PG-4, FX-11). */
export class MongoPageLayoutRepository implements PageLayoutRepository, PreviewTokenRepository {
	async page(pageType: PageTypeKey, target: string): Promise<BuilderPage | null> {
		const doc = await BuilderPageModel.findById(pageId(pageType, target)).lean<BuilderPageDoc>().exec();
		return doc ? toPage(doc) : null;
	}

	async layouts(pageType: PageTypeKey, target: string): Promise<PageLayout[]> {
		const docs = await PageLayoutModel.find({ pageType, target })
			.sort({ updatedAt: -1 })
			.lean<PageLayoutDoc[]>()
			.exec();
		return docs.map(toLayout);
	}

	async layout(id: string): Promise<PageLayout | null> {
		const doc = await PageLayoutModel.findById(id).lean<PageLayoutDoc>().exec();
		return doc ? toLayout(doc) : null;
	}

	async revision(id: string): Promise<LayoutRevision | null> {
		const doc = await PageLayoutRevisionModel.findById(id).lean<LayoutRevisionDoc>().exec();
		return doc ? toRevision(doc) : null;
	}

	async revisions(layoutId: string, limit: number): Promise<LayoutRevision[]> {
		const docs = await PageLayoutRevisionModel.find({ layoutId })
			.sort({ number: -1 })
			.limit(limit)
			.lean<LayoutRevisionDoc[]>()
			.exec();
		return docs.map(toRevision);
	}

	async createLayout(layout: PageLayout): Promise<void> {
		await PageLayoutModel.create({
			_id: layout.id,
			pageType: layout.pageType,
			target: layout.target,
			name: layout.name,
			template: layout.template,
			draftRevisionId: null,
			lastLiveRevisionId: null,
			revisionCount: 0,
			createdAt: new Date(layout.createdAt),
			updatedAt: new Date(layout.updatedAt),
			updatedBy: layout.updatedBy,
		});
	}

	async renameLayout(
		id: string,
		name: string,
		template: string | null,
		by: string | null,
		at: string,
	): Promise<void> {
		await PageLayoutModel.updateOne(
			{ _id: id },
			{ $set: { name, template, updatedBy: by, updatedAt: new Date(at) } },
		).exec();
	}

	async saveDraft(input: {
		layoutId: string;
		sections: PageSection[];
		expectedDraftId: string | null;
		by: string | null;
		at: string;
	}): Promise<LayoutRevision | null> {
		const session = await PageLayoutModel.db.startSession();
		try {
			let written: LayoutRevisionDoc | null = null;
			await session.withTransaction(async () => {
				written = null;
				const id = `rev_${randomUUID()}`;
				// Only over the draft the editor started from: a save over a newer revision is refused.
				const layout = await PageLayoutModel.findOneAndUpdate(
					{ _id: input.layoutId, draftRevisionId: input.expectedDraftId },
					{
						$inc: { revisionCount: 1 },
						$set: { draftRevisionId: id, updatedBy: input.by, updatedAt: new Date(input.at) },
					},
					{ new: true, session },
				)
					.lean<PageLayoutDoc>()
					.exec();
				if (!layout) return;
				const doc: LayoutRevisionDoc = {
					_id: id,
					layoutId: input.layoutId,
					number: layout.revisionCount,
					sections: input.sections,
					assetIds: sectionAssetIds(input.sections),
					createdAt: new Date(input.at),
					createdBy: input.by,
					wentLiveAt: null,
				};
				await PageLayoutRevisionModel.create([doc], { session });
				written = doc;
			});
			return written ? toRevision(written) : null;
		} finally {
			await session.endSession();
		}
	}

	async goLive(input: {
		pageType: PageTypeKey;
		target: string;
		entry: ScheduleEntry;
		also?: ScheduleEntry[];
		at: string;
	}): Promise<void> {
		const session = await PageLayoutModel.db.startSession();
		try {
			await session.withTransaction(async () => {
				const at = new Date(input.at);
				await BuilderPageModel.updateOne(
					{ _id: pageId(input.pageType, input.target) },
					{
						$setOnInsert: { pageType: input.pageType, target: input.target },
						$push: { schedule: { $each: [input.entry, ...(input.also ?? [])].map(fromEntry) } },
						$set: { updatedAt: at },
					},
					{ upsert: true, session },
				).exec();
				await PageLayoutRevisionModel.updateOne(
					{ _id: input.entry.revisionId, wentLiveAt: null },
					{ $set: { wentLiveAt: at } },
					{ session },
				).exec();
				await PageLayoutModel.updateOne(
					{ _id: input.entry.layoutId },
					{ $set: { lastLiveRevisionId: input.entry.revisionId, updatedAt: at } },
					{ session },
				).exec();
			});
		} finally {
			await session.endSession();
		}
	}

	async lock(input: { layoutId: string; by: string; at: string; staleBefore: string }): Promise<HeldLock | null> {
		const now = new Date(input.at);
		// Kept: the holder's heartbeat moves on.
		let doc = await PageLayoutModel.findOneAndUpdate(
			{ _id: input.layoutId, 'lock.holder': input.by },
			{ $set: { 'lock.heartbeatAt': now } },
			{ new: true },
		)
			.lean<PageLayoutDoc>()
			.exec();
		// Taken: free, or its holder stopped beating; one atomic update, so two admins never both get it.
		doc ??= await PageLayoutModel.findOneAndUpdate(
			{
				_id: input.layoutId,
				$or: [{ lock: null }, { 'lock.heartbeatAt': { $lt: new Date(input.staleBefore) } }],
			},
			{ $set: { lock: { holder: input.by, since: now, heartbeatAt: now } } },
			{ new: true },
		)
			.lean<PageLayoutDoc>()
			.exec();
		// Held by someone else.
		doc ??= await PageLayoutModel.findById(input.layoutId).lean<PageLayoutDoc>().exec();
		return doc?.lock ? toLock(doc.lock) : null;
	}

	async createCode(input: {
		codeHash: string;
		layoutId: string;
		revisionId?: string | null;
		by: string | null;
		expiresAt: string;
	}): Promise<void> {
		await this.pushToken(input.layoutId, {
			hash: input.codeHash,
			kind: 'code',
			revisionId: input.revisionId ?? null,
			expiresAt: input.expiresAt,
		});
	}

	async useCode(codeHash: string, now: string): Promise<{ layoutId: string; revisionId: string | null } | null> {
		const at = new Date(now);
		const doc = await PageLayoutModel.findOneAndUpdate(
			{ previewTokens: { $elemMatch: { hash: codeHash, kind: 'code', usedAt: null, expiresAt: { $gt: at } } } },
			{ $set: { 'previewTokens.$.usedAt': at } },
			{ projection: { _id: 1, previewTokens: { $elemMatch: { hash: codeHash } } } },
		)
			.lean<Pick<PageLayoutDoc, '_id' | 'previewTokens'>>()
			.exec();
		return doc ? { layoutId: doc._id, revisionId: doc.previewTokens?.[0]?.revisionId ?? null } : null;
	}

	async createSession(input: {
		tokenHash: string;
		layoutId: string;
		revisionId?: string | null;
		expiresAt: string;
	}): Promise<void> {
		await this.pushToken(input.layoutId, {
			hash: input.tokenHash,
			kind: 'session',
			revisionId: input.revisionId ?? null,
			expiresAt: input.expiresAt,
		});
	}

	async findSession(tokenHash: string, now: string): Promise<{ layoutId: string; revisionId: string | null } | null> {
		const doc = await PageLayoutModel.findOne(
			{ previewTokens: { $elemMatch: { hash: tokenHash, kind: 'session', expiresAt: { $gt: new Date(now) } } } },
			{ _id: 1, previewTokens: { $elemMatch: { hash: tokenHash } } },
		)
			.lean<Pick<PageLayoutDoc, '_id' | 'previewTokens'>>()
			.exec();
		return doc ? { layoutId: doc._id, revisionId: doc.previewTokens?.[0]?.revisionId ?? null } : null;
	}

	/** Keeps the 20 newest preview codes and sessions on a layout; older ones have expired long before. */
	private async pushToken(
		layoutId: string,
		token: { hash: string; kind: 'code' | 'session'; revisionId: string | null; expiresAt: string },
	) {
		await PageLayoutModel.updateOne(
			{ _id: layoutId },
			{
				$push: {
					previewTokens: {
						$each: [{ ...token, expiresAt: new Date(token.expiresAt), usedAt: null }],
						$slice: -20,
					},
				},
			},
		).exec();
	}

	async unlock(layoutId: string, by: string): Promise<void> {
		await PageLayoutModel.updateOne({ _id: layoutId, 'lock.holder': by }, { $set: { lock: null } }).exec();
	}

	async currentLock(layoutId: string, staleBefore: string): Promise<HeldLock | null> {
		const doc = await PageLayoutModel.findById(layoutId, { lock: 1 }).lean<PageLayoutDoc>().exec();
		if (!doc?.lock || new Date(doc.lock.heartbeatAt) < new Date(staleBefore)) return null;
		return toLock(doc.lock);
	}

	async saveSettings(pageType: PageTypeKey, target: string, settings: PageSettings, at: string): Promise<void> {
		await BuilderPageModel.updateOne(
			{ _id: pageId(pageType, target) },
			{
				$setOnInsert: { pageType, target, schedule: [] },
				$set: { settings, updatedAt: new Date(at) },
			},
			{ upsert: true },
		).exec();
	}

	async setSchedule(pageType: PageTypeKey, target: string, schedule: ScheduleEntry[], at: string): Promise<void> {
		await BuilderPageModel.updateOne(
			{ _id: pageId(pageType, target) },
			{
				$setOnInsert: { pageType, target },
				$set: { schedule: schedule.map(fromEntry), updatedAt: new Date(at) },
			},
			{ upsert: true },
		).exec();
	}

	async setSafeMode(
		pageType: PageTypeKey,
		target: string,
		safeMode: BuilderPage['safeMode'],
		at: string,
	): Promise<void> {
		await BuilderPageModel.updateOne(
			{ _id: pageId(pageType, target) },
			{
				$setOnInsert: { pageType, target },
				$set: {
					safeMode: safeMode ? { by: safeMode.by, at: new Date(safeMode.at) } : null,
					updatedAt: new Date(at),
				},
			},
			{ upsert: true },
		).exec();
	}

	async setPending(pageType: PageTypeKey, target: string, pending: PendingGoLive[], at: string): Promise<void> {
		await BuilderPageModel.updateOne(
			{ _id: pageId(pageType, target) },
			{
				$setOnInsert: { pageType, target },
				$set: { pending: pending.map((row) => PendingGoLive.parse(row)), updatedAt: new Date(at) },
			},
			{ upsert: true },
		).exec();
	}

	async setReviewRequest(layoutId: string, request: PageLayout['reviewRequest']): Promise<void> {
		await PageLayoutModel.updateOne(
			{ _id: layoutId },
			{
				$set: {
					reviewRequest: request ? { by: request.by, at: new Date(request.at), note: request.note } : null,
				},
			},
		).exec();
	}

	async reviewRequests(): Promise<PageLayout[]> {
		const docs = await PageLayoutModel.find({ reviewRequest: { $ne: null } })
			.sort({ 'reviewRequest.at': -1 })
			.lean<PageLayoutDoc[]>()
			.exec();
		return docs.map(toLayout);
	}

	async prune(input: { keepGoLive: number; draftsAfter: string }): Promise<number> {
		// Never removed: anything a schedule or a layout points at.
		const pages = await BuilderPageModel.find({}, { schedule: 1 }).lean<BuilderPageDoc[]>().exec();
		const layouts = await PageLayoutModel.find({}, { draftRevisionId: 1, lastLiveRevisionId: 1 })
			.lean<PageLayoutDoc[]>()
			.exec();
		const pinned = new Set<string>([
			...pages.flatMap((page) => (page.schedule ?? []).map((entry) => entry.revisionId)),
			...layouts
				.flatMap((layout) => [layout.draftRevisionId, layout.lastLiveRevisionId])
				.filter((id): id is string => !!id),
		]);
		const cutoff = new Date(input.draftsAfter);
		let removed = 0;
		for (const layout of layouts) {
			const revisions = await PageLayoutRevisionModel.find(
				{ layoutId: layout._id },
				{ number: 1, wentLiveAt: 1, createdAt: 1 },
			)
				.sort({ number: -1 })
				.lean<LayoutRevisionDoc[]>()
				.exec();
			const keptLive = new Set(
				revisions
					.filter((revision) => revision.wentLiveAt)
					.slice(0, input.keepGoLive)
					.map((revision) => revision._id),
			);
			const drop = revisions
				.filter(
					(revision) =>
						!pinned.has(revision._id) &&
						!keptLive.has(revision._id) &&
						(revision.wentLiveAt !== null || new Date(revision.createdAt) < cutoff),
				)
				.map((revision) => revision._id);
			if (drop.length) {
				const result = await PageLayoutRevisionModel.deleteMany({ _id: { $in: drop } }).exec();
				removed += result.deletedCount;
			}
		}
		return removed;
	}
}

const toBlock = (doc: SavedBlockDoc): SavedBlock => ({
	id: doc._id,
	name: doc.name,
	section: doc.section as PageSection,
	createdAt: new Date(doc.createdAt).toISOString(),
	updatedAt: new Date(doc.updatedAt).toISOString(),
	updatedBy: doc.updatedBy ?? null,
});

/** Saved blocks (SG-5): sections kept on their own, copied or linked into layouts. */
export class MongoSavedBlockRepository implements SavedBlockRepository {
	async list(): Promise<SavedBlock[]> {
		const docs = await SavedBlockModel.find({}).sort({ name: 1 }).lean<SavedBlockDoc[]>().exec();
		return docs.map(toBlock);
	}

	async find(id: string): Promise<SavedBlock | null> {
		const doc = await SavedBlockModel.findById(id).lean<SavedBlockDoc>().exec();
		return doc ? toBlock(doc) : null;
	}

	async save(block: SavedBlock): Promise<void> {
		await SavedBlockModel.updateOne(
			{ _id: block.id },
			{
				$set: {
					name: block.name,
					section: block.section,
					assetIds: sectionAssetIds([block.section]),
					updatedAt: new Date(block.updatedAt),
					updatedBy: block.updatedBy,
				},
				$setOnInsert: { createdAt: new Date(block.createdAt) },
			},
			{ upsert: true },
		).exec();
	}

	async remove(id: string): Promise<void> {
		await SavedBlockModel.deleteOne({ _id: id }).exec();
	}
}
