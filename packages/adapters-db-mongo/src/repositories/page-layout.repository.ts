import { randomUUID } from 'node:crypto';

import type {
	BuilderPage,
	LayoutRevision,
	PageLayout,
	PageSection,
	PageTypeKey,
	SavedBlock,
	ScheduleEntry,
} from '@saha-textile/contracts';
import type { PageLayoutRepository, SavedBlockRepository } from '@saha-textile/core-domain';

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
	updatedAt: new Date(doc.updatedAt).toISOString(),
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
export class MongoPageLayoutRepository implements PageLayoutRepository {
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

	async goLive(input: { pageType: PageTypeKey; target: string; entry: ScheduleEntry; at: string }): Promise<void> {
		const session = await PageLayoutModel.db.startSession();
		try {
			await session.withTransaction(async () => {
				const at = new Date(input.at);
				await BuilderPageModel.updateOne(
					{ _id: pageId(input.pageType, input.target) },
					{
						$setOnInsert: { pageType: input.pageType, target: input.target },
						$push: { schedule: fromEntry(input.entry) },
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
				removed += result.deletedCount ?? 0;
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
