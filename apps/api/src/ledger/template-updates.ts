import { randomUUID } from 'node:crypto';

import {
	Body,
	ConflictException,
	Controller,
	Get,
	Header,
	HttpCode,
	Inject,
	Injectable,
	Param,
	Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	TemplateInstallWrite,
	type ChartTemplateContent,
	type TemplateLibraryRow,
	type TemplateUpdate,
} from '@saha-textile/contracts';
import {
	keptChanges,
	latestVersion,
	versionChanges,
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
import { addChartItems } from './chart-additions';
import { LedgerService } from './ledger.service';

/**
 * Template updates (accounts templates plan AT7, AT-D5): a newer version than the one installed is offered, never
 * installed by itself. The person sees what it changes and which of the company's own changes are kept; Install adds
 * the chart's missing groups and ledgers (nothing of the company's is renamed, moved or removed) and records the version.
 * Documents dated before the version's first day keep the rule they were made with.
 */
@Injectable()
export class TemplateUpdatesService {
	constructor(
		@Inject(LedgerService) private readonly ledger: LedgerService,
		@Inject(AccountsTemplatesService) private readonly templates: AccountsTemplatesService,
		@Inject(GENERAL_LEDGER_REPOSITORY)
		private readonly books: Pick<GeneralLedgerRepository, 'saveGroup' | 'saveLedger'>,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: Pick<AuditLogRepository, 'append'>,
	) {}

	/** The template and its newest version, refused when nothing newer than the installed one waits. */
	private async pending(code: string) {
		const template = await this.templates.get(code);
		const row = (await this.templates.library()).find((each) => each.code === code) as TemplateLibraryRow;
		if (!row.updateAvailable) throw new ConflictException(accountsRefusal('template_no_update'));
		return { template, installed: row.installedVersion as number, newest: latestVersion(template) };
	}

	/** AT7: what the newer version changes, and what of the company's is kept. */
	async update(code: string): Promise<TemplateUpdate> {
		const { template, installed, newest } = await this.pending(code);
		const [books, start] = await Promise.all([this.ledger.chart(), this.templates.startingChart()]);
		const before = template.versions.find((version) => version.version === installed)?.content ?? null;
		return {
			code: template.code,
			name: template.name,
			kind: template.kind,
			installedVersion: installed,
			version: newest.version,
			validFrom: newest.validFrom,
			changes: versionChanges(before, newest.content),
			kept: keptChanges(newest.content, books, start.chart),
		};
	}

	/** AT7 Install: the version the person saw, its missing chart items added, the install recorded and logged. */
	async install(
		code: string,
		write: TemplateInstallWrite,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<TemplateLibraryRow[]> {
		const { installed, newest } = await this.pending(code);
		if (write.version !== newest.version) throw new ConflictException(accountsRefusal('template_update_changed'));
		const at = now.toISOString();
		const added = newest.content.kind === 'chart' ? await this.addToBooks(newest.content, at) : [];
		const by = principal?.userId ?? null;
		await this.templates.markInstalled(code, newest.version, by, now);
		await this.audit.append({
			id: `aud_${randomUUID()}`,
			actorUserId: by,
			targetUserId: null,
			audience: 'admin',
			action: 'accounts.template.install',
			entityType: 'accounts_template',
			entityId: code,
			severity: 'info',
			retentionTier: 'books',
			diffs: [{ field: 'version', before: String(installed), after: String(newest.version) }],
			metadata: { added: added.join(', ') },
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: at,
		});
		return this.templates.library();
	}

	/** The chart version's groups and ledgers the books lack, by key; returns their names. */
	private async addToBooks(content: ChartTemplateContent, at: string): Promise<string[]> {
		return addChartItems(this.books, content, await this.ledger.chart(), at);
	}
}

@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/accounts/templates')
export class TemplateUpdatesController {
	constructor(private readonly updates: TemplateUpdatesService) {}

	@Get(':code/update')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({
		operationId: 'accountsTemplateUpdate',
		summary: 'A newer template version and what it changes (AT7)',
	})
	update(@Param('code') code: string): Promise<TemplateUpdate> {
		return this.updates.update(code);
	}

	@Post(':code/install')
	@HttpCode(200)
	@RequirePermissions('accounts_template.edit')
	@ApiOperation({ operationId: 'accountsTemplateInstall', summary: 'Install a newer template version (AT7)' })
	install(
		@Param('code') code: string,
		@Body(new ZodValidationPipe(TemplateInstallWrite)) body: TemplateInstallWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	): Promise<TemplateLibraryRow[]> {
		return this.updates.install(code, body, principal);
	}
}
