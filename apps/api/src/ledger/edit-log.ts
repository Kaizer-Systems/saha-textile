import { randomUUID } from 'node:crypto';

import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, Injectable, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type DocumentLock, DocumentLockTarget, type EditLogEntry } from '@saha-textile/contracts';
import type {
	AdminUserRepository,
	AdminUserRoleAssignmentRepository,
	AuditLogRepository,
	DocumentLockRepository,
	RoleRepository,
} from '@saha-textile/core-domain';

import { accountsRefusal } from './accounts-refusal';
import { Principal } from '../auth/ownership';
import { Audience, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
	ADMIN_USER_REPOSITORY,
	ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	DOCUMENT_LOCK_REPOSITORY,
	ROLE_REPOSITORY,
} from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';

/**
 * A document's edit log (Q11, B5) and the people in it: every row of the audit log for that document, oldest
 * first, with who did it and their role. Rows written by the system on its own have no person.
 */
@Injectable()
export class EditLogService {
	constructor(
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: Pick<AuditLogRepository, 'list' | 'append'>,
		@Inject(ADMIN_USER_REPOSITORY) private readonly admins: Pick<AdminUserRepository, 'findById'>,
		@Inject(ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY)
		private readonly assignments: Pick<AdminUserRoleAssignmentRepository, 'listActiveForUser'>,
		@Inject(ROLE_REPOSITORY) private readonly roles: Pick<RoleRepository, 'findById'>,
	) {}

	/** The name others see: display name, else e-mail, else username. */
	async nameOf(userId: string): Promise<string> {
		const user = await this.admins.findById(userId);
		return user?.displayName || user?.email || user?.username || userId;
	}

	/** Their first live role's label (Q11 "Meera Sharma (Location manager)"). */
	async roleOf(userId: string): Promise<string | null> {
		const [assignment] = await this.assignments.listActiveForUser(userId);
		if (!assignment) return null;
		return (await this.roles.findById(assignment.roleId))?.label ?? null;
	}

	async entries(entityType: string, entityId: string): Promise<EditLogEntry[]> {
		const page = await this.audit.list({ entityType, entityId, page: 1, pageSize: 200 });
		const people = new Map<string, Promise<{ who: string; role: string | null }>>();
		const person = (id: string) => {
			let found = people.get(id);
			if (!found) {
				found = Promise.all([this.nameOf(id), this.roleOf(id)]).then(([who, role]) => ({ who, role }));
				people.set(id, found);
			}
			return found;
		};
		const rows = [...page.items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		return Promise.all(
			rows.map(async (row) => {
				const actor = row.actorUserId ? await person(row.actorUserId) : { who: null, role: null };
				return {
					at: row.createdAt,
					who: actor.who,
					role: actor.role,
					action: row.action,
					diffs: row.diffs,
					metadata: row.metadata,
				};
			}),
		);
	}

	/** One row of a document's log, kept with the books (8 years). */
	async append(
		actorId: string | null,
		action: string,
		entityType: string,
		entityId: string,
		diffs: { field: string; before?: unknown; after?: unknown }[],
		metadata: Record<string, unknown> = {},
	): Promise<void> {
		await this.audit.append({
			id: `aud_${randomUUID()}`,
			actorUserId: actorId,
			targetUserId: null,
			audience: 'admin',
			action,
			entityType,
			entityId,
			severity: 'info',
			retentionTier: 'books',
			diffs,
			metadata,
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		});
	}
}

/**
 * B7 beside the document locks: who holds a document (the holder sees a release asked of them only when it was
 * asked after they took it), and "Ask them to release it".
 */
@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/document-locks')
export class DocumentLockAsksController {
	constructor(
		@Inject(DOCUMENT_LOCK_REPOSITORY) private readonly locks: DocumentLockRepository,
		private readonly log: EditLogService,
	) {}

	@Get(':documentType/:documentId')
	@ApiOperation({ operationId: 'documentLock', summary: 'Who holds a document for editing, if anyone' })
	async current(
		@Param('documentType') documentType: string,
		@Param('documentId') documentId: string,
	): Promise<{ lock: DocumentLock | null; role: string | null }> {
		const lock = await this.locks.get(documentType, documentId);
		if (!lock) return { lock: null, role: null };
		const asked = !!lock.releaseAskedAt && lock.releaseAskedAt >= lock.since;
		return {
			lock: asked ? lock : { ...lock, releaseAskedBy: null, releaseAskedAt: null },
			role: await this.log.roleOf(lock.holderId),
		};
	}

	@Post('ask-release')
	@HttpCode(200)
	@ApiOperation({ operationId: 'askDocumentRelease', summary: 'Ask the person editing a document to let it go' })
	async askRelease(
		@Body(new ZodValidationPipe(DocumentLockTarget)) body: DocumentLockTarget,
		@Principal() principal?: AuthenticatedPrincipal,
	): Promise<{ asked: boolean }> {
		if (!principal) throw new ForbiddenException(accountsRefusal('document_lock_refused'));
		const name = await this.log.nameOf(principal.userId);
		const asked = await this.locks.askRelease(body.documentType, body.documentId, name, new Date().toISOString());
		if (asked)
			await this.log.append(
				principal.userId,
				'document.lock.ask_release',
				body.documentType,
				body.documentId,
				[],
			);
		return { asked };
	}
}
