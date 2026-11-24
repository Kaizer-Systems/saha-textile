import { NotFoundException } from '@nestjs/common';
import { PageSection, type SavedBlock } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { PageBlocksService } from '../src/page-builder/page-blocks.service';
import { memoryLayouts } from './page-builder-memory';

const T0 = '2026-11-24T10:00:00.000Z';
const letter = PageSection.parse({ id: 'news', type: 'newsletter', title: { en: 'Join', bn: 'যোগ দিন' } });
const block = (id: string, updatedBy: string | null = null): SavedBlock => ({
	id,
	name: id,
	section: { ...letter, id } as PageSection,
	createdAt: T0,
	updatedAt: T0,
	updatedBy,
});

async function setup(findById: (id: string) => Promise<unknown> = async () => null, audit = true) {
	const store = memoryLayouts();
	const blocks = new Map<string, SavedBlock>([
		['blk_used', block('blk_used', 'adm_1')],
		['blk_free', block('blk_free')],
	]);
	// One layout links blk_used in its draft and in the revision that went live.
	await store.repo.createLayout({
		id: 'lay_1',
		pageType: 'home',
		target: 'page',
		name: 'Home',
		template: null,
		draftRevisionId: null,
		lastLiveRevisionId: null,
		createdAt: T0,
		updatedAt: T0,
		updatedBy: null,
	} as never);
	const linked = { ...letter, block: { id: 'blk_used', linked: true } } as PageSection;
	const live = await store.repo.saveDraft({
		layoutId: 'lay_1',
		sections: [linked],
		expectedDraftId: null,
		by: null,
		at: T0,
	});
	await store.repo.goLive({
		pageType: 'home',
		target: 'page',
		entry: { revisionId: live?.id as string, layoutId: 'lay_1', from: T0, until: null, by: null },
		at: T0,
	});
	await store.repo.saveDraft({
		layoutId: 'lay_1',
		sections: [linked],
		expectedDraftId: live?.id ?? null,
		by: null,
		at: T0,
	});
	const auditLog = { append: vi.fn(async () => undefined) };
	const service = new PageBlocksService(
		{
			list: async () => [...blocks.values()],
			find: async (id: string) => blocks.get(id) ?? null,
			save: async (row: SavedBlock) => void blocks.set(row.id, row),
			remove: vi.fn(async (id: string) => void blocks.delete(id)),
		} as never,
		store.repo,
		{ findById } as never,
		(audit ? auditLog : null) as never,
	);
	return { service, blocks, auditLog };
}

const request = { name: 'Puja promo', section: letter } as never;

describe('saved page blocks: the remaining cases', () => {
	it('counts each layout linking a block once, and none for a block nobody links', async () => {
		const { service } = await setup(async () => ({ displayName: 'Moulik' }));
		const rows = await service.list();
		expect(rows.map((row) => [row.block.id, row.linkedUses, row.updatedByName])).toEqual([
			['blk_used', 1, 'Moulik'],
			['blk_free', 0, null],
		]);
	});

	it('updates a block, counting its linked layouts, and refuses one that does not exist', async () => {
		const { service } = await setup();
		expect((await service.update('adm_1', 'blk_used', request, new Date(T0))).linkedUses).toBe(1);
		expect((await service.update('adm_1', 'blk_free', request, new Date(T0))).linkedUses).toBe(0);
		await expect(service.update('adm_1', 'blk_none', request)).rejects.toBeInstanceOf(NotFoundException);
	});

	it('deletes a block nobody links, and refuses one that does not exist or is linked', async () => {
		const { service, blocks } = await setup();
		await expect(service.remove('adm_1', 'blk_none')).rejects.toBeInstanceOf(NotFoundException);
		await expect(service.remove('adm_1', 'blk_used')).rejects.toMatchObject({ response: { code: 'block_in_use' } });
		await service.remove('adm_1', 'blk_free');
		expect(blocks.has('blk_free')).toBe(false);
	});

	it('names who changed a block by any name they have, nobody when unknown or unreadable, and records nothing without an audit store', async () => {
		const findById = vi
			.fn()
			.mockResolvedValueOnce({ displayName: null, username: 'rina' })
			.mockResolvedValueOnce({ displayName: null, username: null, email: 'rina@example.test' })
			.mockResolvedValueOnce({ displayName: null, username: null, email: null })
			.mockRejectedValueOnce(new Error('down'));
		const { service, auditLog } = await setup(findById, false);
		const names = [];
		for (let index = 0; index < 4; index += 1)
			names.push((await service.create('adm_x', request, new Date(T0))).updatedByName);
		expect(names).toEqual(['rina', 'rina@example.test', null, null]);
		expect(auditLog.append).not.toHaveBeenCalled();
	});
});
