import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	Body,
	ConflictException,
	Controller,
	ForbiddenException,
	Get,
	Header,
	Inject,
	Injectable,
	Param,
	Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolePoint, type Ledger, type RoleRow } from '@saha-textile/contracts';
import {
	ROLE_REGISTRY,
	rolesOf,
	withRole,
	withoutRole,
	type AuditLogRepository,
	type GeneralLedgerRepository,
} from '@saha-textile/core-domain';

import { AccountsTemplatesService } from '../accounts-templates/accounts-templates.service';
import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AUDIT_LOG_REPOSITORY, GENERAL_LEDGER_REPOSITORY } from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';
import { accountsRefusal } from './accounts-refusal';
import { LedgerService } from './ledger.service';

/**
 * Roles in this company's books (accounts templates AT4): every role the engine posts to, which ledger or group plays
 * it, and the installed template that set it. The list of roles is the engine's; which ledger plays one is data, and a
 * super admin may point a ledger role at another ledger (the old one stops playing it).
 */
@Injectable()
export class RolesService {
	constructor(
		private readonly ledger: LedgerService,
		private readonly templates: AccountsTemplatesService,
		@Inject(GENERAL_LEDGER_REPOSITORY) private readonly books: Pick<GeneralLedgerRepository, 'saveLedger'>,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: Pick<AuditLogRepository, 'append'>,
	) {}

	async rows(): Promise<RoleRow[]> {
		const [chart, charts] = await Promise.all([this.ledger.chart(), this.templates.installedCharts()]);
		return ROLE_REGISTRY.map((role) => {
			const pool: readonly {
				id: string;
				name: string;
				systemKey: string | null;
				roles: string[];
				active?: boolean;
			}[] = role.target === 'ledger' ? chart.ledgers : chart.groups;
			const holders = pool.filter((h) => h.active !== false && rolesOf(h).includes(role.key));
			const only = holders.length === 1 ? holders[0] : undefined;
			return {
				key: role.key,
				target: role.target,
				usedBy: [...role.neededBy],
				holderId: only?.id ?? null,
				holderName: only?.name ?? null,
				// A ledger a person pointed the role at, or made by hand, came from no template.
				fromTemplate: (only && charts.find((c) => c.keys.has(String(only.systemKey)))?.label) ?? null,
				problem: holders.length === 0 ? 'missing' : holders.length > 1 ? 'ambiguous' : null,
			};
		});
	}

	private async save(ledger: Ledger, roles: string[], by: string | null, now: string): Promise<void> {
		try {
			await this.books.saveLedger({ ...ledger, roles, updatedAt: now, updatedBy: by }, ledger.updatedAt);
		} catch (error) {
			if ((error as Error).message === 'ledger_changed')
				throw new ConflictException(accountsRefusal('ledger_changed'));
			throw error;
		}
	}

	async point(key: string, write: RolePoint, principal: AuthenticatedPrincipal | undefined): Promise<RoleRow[]> {
		if (!(await this.ledger.isSuperAdmin(principal)))
			throw new ForbiddenException(accountsRefusal('roles_super_admin_only'));
		if (!ROLE_REGISTRY.some((role) => role.key === key && role.target === 'ledger'))
			throw new BadRequestException(accountsRefusal('role_unknown'));
		const chart = await this.ledger.chart();
		const target = chart.ledgers.find((l) => l.id === write.ledgerId && l.active);
		if (!target) throw new BadRequestException(accountsRefusal('role_ledger_unknown'));
		const by = principal?.userId ?? null;
		const now = new Date().toISOString();
		const before = chart.ledgers.filter((l) => l.id !== target.id && rolesOf(l).includes(key));
		for (const ledger of before) await this.save(ledger, withoutRole(ledger, key), by, now);
		await this.save(target, withRole(target, key), by, now);
		await this.audit.append({
			id: `aud_${randomUUID()}`,
			actorUserId: by,
			targetUserId: null,
			audience: 'admin',
			action: 'accounts.role.point',
			entityType: 'ledger',
			entityId: target.id,
			severity: 'info',
			retentionTier: 'books',
			diffs: [{ field: key, before: before.map((l) => l.name).join(', ') || null, after: target.name }],
			metadata: { role: key },
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: now,
		});
		return this.rows();
	}
}

@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/accounts/roles')
export class RolesController {
	constructor(private readonly roles: RolesService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'accountsRoles', summary: "Roles in this company's books (AT4)" })
	rows() {
		return this.roles.rows();
	}

	@Put(':key')
	@RequirePermissions('accounts_template.edit')
	@ApiOperation({ operationId: 'pointAccountsRole', summary: 'Point a role at another ledger (super admin)' })
	point(
		@Param('key') key: string,
		@Body(new ZodValidationPipe(RolePoint)) body: RolePoint,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.roles.point(key, body, principal);
	}
}
