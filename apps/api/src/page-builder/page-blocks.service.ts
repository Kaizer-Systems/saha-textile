import { randomUUID } from 'node:crypto';

import { ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { AdminSavedBlockRow, AuditLog, PageTypeKey, SaveBlockRequest, SavedBlock } from '@saha-textile/contracts';
import {
	type AdminUserRepository,
	type AuditLogRepository,
	type PageLayoutRepository,
	type SavedBlockRepository,
	blockSection,
	linkedBlockIds,
	registeredPageTypes,
} from '@saha-textile/core-domain';

import {
	ADMIN_USER_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	PAGE_LAYOUT_REPOSITORY,
	SAVED_BLOCK_REPOSITORY,
} from '../infra/tokens';

/**
 * Saved blocks (Page Builder SG-5, P7, Q18 A): any section kept on its own and reused as a copy (changes stay in that
 * layout) or linked (one change reaches every layout using it, at its next Go Live). A block a layout is linked to
 * cannot be deleted; unlinking it there first keeps that layout's section as a copy.
 */
@Injectable()
export class PageBlocksService {
	constructor(
		@Inject(SAVED_BLOCK_REPOSITORY) private readonly blocks: SavedBlockRepository,
		@Inject(PAGE_LAYOUT_REPOSITORY) private readonly layouts: PageLayoutRepository,
		@Inject(ADMIN_USER_REPOSITORY) private readonly admins: Pick<AdminUserRepository, 'findById'>,
		@Optional() @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository | null = null,
	) {}

	async list(): Promise<AdminSavedBlockRow[]> {
		const [blocks, uses] = await Promise.all([this.blocks.list(), this.linkedUses()]);
		return Promise.all(
			blocks.map(async (block) => ({
				block,
				linkedUses: uses.get(block.id) ?? 0,
				updatedByName: await this.adminName(block.updatedBy),
			})),
		);
	}

	async create(actor: string | null, request: SaveBlockRequest, now = new Date()): Promise<AdminSavedBlockRow> {
		const id = `blk_${randomUUID()}`;
		const at = now.toISOString();
		const block: SavedBlock = {
			id,
			name: request.name,
			section: blockSection(request.section, id),
			createdAt: at,
			updatedAt: at,
			updatedBy: actor,
		};
		await this.blocks.save(block);
		await this.record(actor, 'page_block.create', id, { type: block.section.type });
		return { block, linkedUses: 0, updatedByName: await this.adminName(actor) };
	}

	/** A change to a block: linked layouts take it at their next Go Live. */
	async update(
		actor: string | null,
		id: string,
		request: SaveBlockRequest,
		now = new Date(),
	): Promise<AdminSavedBlockRow> {
		const current = await this.blocks.find(id);
		if (!current) throw new NotFoundException('No such block');
		const block: SavedBlock = {
			...current,
			name: request.name,
			section: blockSection(request.section, id),
			updatedAt: now.toISOString(),
			updatedBy: actor,
		};
		await this.blocks.save(block);
		const uses = (await this.linkedUses()).get(id) ?? 0;
		await this.record(actor, 'page_block.update', id, { linkedUses: uses });
		return { block, linkedUses: uses, updatedByName: await this.adminName(actor) };
	}

	async remove(actor: string | null, id: string): Promise<void> {
		if (!(await this.blocks.find(id))) throw new NotFoundException('No such block');
		const uses = (await this.linkedUses()).get(id) ?? 0;
		if (uses > 0) {
			throw new ConflictException({
				message: 'Layouts are linked to this block',
				code: 'block_in_use',
				linkedUses: uses,
			});
		}
		await this.blocks.remove(id);
		await this.record(actor, 'page_block.delete', id, {});
	}

	/** How many layouts link each block, from their draft and their last live revision. */
	private async linkedUses(): Promise<Map<string, number>> {
		const counts = new Map<string, number>();
		for (const rules of registeredPageTypes()) {
			const layouts = await this.layouts.layouts(rules.key as PageTypeKey, 'page');
			for (const layout of layouts) {
				const ids = new Set<string>();
				for (const revisionId of [layout.draftRevisionId, layout.lastLiveRevisionId]) {
					const revision = revisionId ? await this.layouts.revision(revisionId) : null;
					for (const blockId of linkedBlockIds(revision?.sections ?? [])) ids.add(blockId);
				}
				for (const blockId of ids) counts.set(blockId, (counts.get(blockId) ?? 0) + 1);
			}
		}
		return counts;
	}

	private async adminName(id: string | null): Promise<string | null> {
		if (!id) return null;
		const admin = await this.admins.findById(id).catch(() => null);
		return admin ? (admin.displayName ?? admin.username ?? admin.email ?? null) : null;
	}

	private async record(
		actor: string | null,
		action: string,
		entityId: string,
		metadata: Record<string, unknown>,
	): Promise<void> {
		if (!this.audit) return;
		const entry: AuditLog = {
			id: `audit_${randomUUID()}`,
			actorUserId: actor,
			targetUserId: null,
			audience: 'admin',
			action,
			entityType: 'page_block',
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
