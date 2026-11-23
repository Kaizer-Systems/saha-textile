import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	Body,
	Controller,
	ForbiddenException,
	Get,
	Header,
	Inject,
	Injectable,
	Post,
	Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	AccountGroup,
	type BusinessKind,
	type ChartOfAccounts,
	type ChartTemplateContent,
	ConvertQuery,
	type ConvertPreview,
	type ConvertResult,
	ConvertWrite,
	Ledger,
} from '@saha-textile/contracts';
import {
	KIND_CHART_CODES,
	convertLines,
	convertProblems,
	convertRows,
	istDay,
	latestVersion,
	monthsThrough,
	nextDay,
	ownersGroupIds,
	type AuditLogRepository,
	type CompanyRepository,
	type ConvertLine,
	type GeneralLedgerRepository,
	type LocationRepository,
	type PeriodLockRepository,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import { AccountsTemplatesService } from '../accounts-templates/accounts-templates.service';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { Principal } from '../auth/ownership';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
	AUDIT_LOG_REPOSITORY,
	COMPANY_REPOSITORY,
	GENERAL_LEDGER_REPOSITORY,
	LOCATION_REPOSITORY,
	PERIOD_LOCK_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';
import { accountsRefusal } from './accounts-refusal';
import { LedgerService } from './ledger.service';

const PARTS = ['sales', 'purchases', 'stock', 'cash', 'bank', 'payroll', 'journal'] as const;

/** The new kind's chart template: its groups and ledgers by key. */
type Template = Pick<ChartTemplateContent, 'groups' | 'ledgers'>;

/** The first day of the financial year before the one a day falls in (the Periods grid's two years). */
const gridStart = (day: string): string => {
	const year = Number(day.slice(0, 4)) - (Number(day.slice(5, 7)) < 4 ? 1 : 0);
	return `${year - 1}-04-01`;
};

/**
 * Convert (Postings and Convert brief AC1, AC2; AC-D1 in the same deployment, AC-D2 the super admin, Preview first,
 * no undo). The old books stay and are locked up to the last day of a month; the new kind's chart template is added;
 * one opening voucher the next day moves the owners' accounts to the new kind's and closes the year's income and
 * expenses so far into where the profit goes; the kind changes and the new kind's templates are recorded as installed.
 * Every step can run again safely: the voucher has one key per last day, and the chart and locks are by key.
 */
@Injectable()
export class ConvertService {
	constructor(
		private readonly ledger: LedgerService,
		private readonly templates: AccountsTemplatesService,
		@Inject(GENERAL_LEDGER_REPOSITORY)
		private readonly books: Pick<GeneralLedgerRepository, 'balancesAt' | 'saveGroup' | 'saveLedger'>,
		@Inject(COMPANY_REPOSITORY) private readonly company: Pick<CompanyRepository, 'getProfile' | 'saveProfile'>,
		@Inject(PERIOD_LOCK_REPOSITORY) private readonly periods: Pick<PeriodLockRepository, 'list' | 'save'>,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: Pick<AuditLogRepository, 'append'>,
		@Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManagerPort,
	) {}

	private async allowed(principal: AuthenticatedPrincipal | undefined) {
		if (!(await this.ledger.isSuperAdmin(principal)))
			throw new ForbiddenException(accountsRefusal('convert_super_admin_only'));
		const profile = await this.company.getProfile();
		if (!profile || !(await this.templates.booksSetUp()))
			throw new BadRequestException(accountsRefusal('convert_books_not_set_up'));
		return profile;
	}

	private async template(kind: BusinessKind): Promise<Template> {
		const version = latestVersion(await this.templates.get(KIND_CHART_CODES[kind]));
		return version.content as Template;
	}

	/** The rows to map, what they can go to, the months locked and what stops it. */
	private async plan(kind: BusinessKind, lastDay: string, from: BusinessKind) {
		const [chart, balances, template] = await Promise.all([
			this.ledger.chart(),
			this.books.balancesAt(lastDay, []),
			this.template(kind),
		]);
		const rows = convertRows(chart, balances, 'Profit up to the last day');
		const owners = ownersGroupIds(chart.groups);
		const templateOwners = ownersGroupIds(
			template.groups.map((g) => ({ id: g.key, parentId: g.parentKey, systemKey: g.key, roles: g.roles })),
		);
		const have = new Set(chart.ledgers.map((l) => l.systemKey));
		const targets: ConvertPreview['targets'] = [
			...chart.ledgers
				.filter((l) => l.active && owners.has(l.groupId))
				.map((l) => ({ ledgerId: l.id, key: null, name: l.name })),
			...template.ledgers
				.filter((l) => templateOwners.has(l.groupKey) && !have.has(l.key))
				.map((l) => ({ ledgerId: null, key: l.key, name: l.name })),
		];
		const problems = convertProblems({
			from,
			to: kind,
			lastDay,
			today: istDay(new Date()),
			rows,
			mapping: Object.fromEntries(rows.map((row) => [row.from, row.from])),
		});
		return { chart, rows, targets, template, problems, months: monthsThrough(gridStart(lastDay), lastDay) };
	}

	async preview(query: ConvertQuery, principal: AuthenticatedPrincipal | undefined): Promise<ConvertPreview> {
		const profile = await this.allowed(principal);
		const plan = await this.plan(query.kind, query.lastDay, profile.kind);
		return {
			from: profile.kind,
			to: query.kind,
			lastDay: query.lastDay,
			openingDate: nextDay(query.lastDay),
			rows: plan.rows,
			targets: plan.targets,
			problems: plan.problems,
			months: plan.months,
		};
	}

	/** The new kind's groups and ledgers the books don't have yet, added by key. */
	private async addTemplate(chart: ChartOfAccounts, template: Template, now: string): Promise<Map<string, string>> {
		const groupIds = new Map(chart.groups.map((g) => [String(g.systemKey), g.id]));
		const natures = new Map(template.groups.map((g) => [g.key, g.nature]));
		for (const [index, group] of template.groups.entries()) {
			if (groupIds.has(group.key)) continue;
			const saved = AccountGroup.parse({
				id: `grp_${group.key}`,
				systemKey: group.key,
				name: group.name,
				parentId: group.parentKey ? (groupIds.get(group.parentKey) ?? `grp_${group.parentKey}`) : null,
				nature: group.nature,
				tradingAccount: group.tradingAccount,
				roles: group.roles,
				order: chart.groups.length + index,
				createdAt: now,
				updatedAt: now,
			});
			await this.books.saveGroup(saved);
			groupIds.set(group.key, saved.id);
		}
		const ledgerIds = new Map(chart.ledgers.map((l) => [String(l.systemKey), l.id]));
		for (const ledger of template.ledgers.filter((l) => !ledgerIds.has(l.key))) {
			const saved = Ledger.parse({
				id: `led_${ledger.key}`,
				systemKey: ledger.key,
				name: ledger.name,
				// Every template ledger's group is in the template (mergeCharts checks), so it was added above.
				groupId: groupIds.get(ledger.groupKey),
				nature: natures.get(ledger.groupKey),
				handPosting: ledger.handPosting,
				roles: ledger.roles,
				createdAt: now,
				updatedAt: now,
			});
			await this.books.saveLedger(saved, null);
			ledgerIds.set(ledger.key, saved.id);
		}
		return ledgerIds;
	}

	async convert(write: ConvertWrite, principal: AuthenticatedPrincipal | undefined): Promise<ConvertResult> {
		const profile = await this.allowed(principal);
		const plan = await this.plan(write.kind, write.lastDay, profile.kind);
		const given = new Map(write.mapping.map((row) => [row.from, row.to]));
		// Each row goes to an owners' ledger the preview offered, or to a new one named on the form.
		const offered = new Set(plan.targets.map((t) => t.ledgerId ?? `key:${String(t.key)}`));
		for (const [from, to] of given)
			if (!('newName' in to) && !offered.has('ledgerId' in to ? to.ledgerId : `key:${to.key}`))
				throw new BadRequestException(accountsRefusal(`convert_target_unknown:${from}`));
		const problems = convertProblems({
			from: profile.kind,
			to: write.kind,
			lastDay: write.lastDay,
			today: istDay(new Date()),
			rows: plan.rows,
			mapping: Object.fromEntries([...given.keys()].map((from) => [from, from])),
		});
		if (problems.length) throw new BadRequestException(accountsRefusal(String(problems[0])));
		const by = principal?.userId ?? null;
		const now = new Date().toISOString();

		// 1. The new kind's chart, and any owners' ledger named on the form.
		const byKey = await this.addTemplate(plan.chart, plan.template, now);
		const owners = plan.chart.groups.find((g) => g.systemKey === 'capital_account');
		const mapping: Record<string, string> = {};
		for (const [from, to] of given) {
			if ('ledgerId' in to) mapping[from] = to.ledgerId;
			else if ('key' in to) mapping[from] = String(byKey.get(to.key));
			else {
				const made = Ledger.parse({
					id: `led_${randomUUID()}`,
					systemKey: null,
					name: to.newName,
					groupId: owners?.id,
					nature: 'equity',
					handPosting: true,
					createdAt: now,
					updatedAt: now,
					updatedBy: by,
				});
				await this.books.saveLedger(made, null);
				mapping[from] = made.id;
			}
		}

		// 2. One opening voucher the next day, location by location.
		const chart = await this.ledger.chart();
		const lines: ConvertLine[] = [];
		for (const location of (await this.locations.list()).filter((l) => l.active)) {
			const balances = await this.books.balancesAt(write.lastDay, [location.id]);
			lines.push(
				...convertLines({
					locationId: location.id,
					ledgers: chart.ledgers,
					balances,
					rows: plan.rows,
					mapping,
				}),
			);
		}
		const voucher = lines.length
			? await this.tx.withTransaction((context) =>
					this.ledger.post(
						{
							kind: 'opening',
							date: nextDay(write.lastDay),
							narration: `Opening balances after converting to ${write.kind}`,
							source: { type: 'convert', id: `convert:${write.lastDay}` },
							idempotencyKey: `convert:${write.lastDay}`,
							lines: lines.map((line) => ({
								ledger: { id: line.ledgerId },
								locationId: line.locationId,
								debitPaise: line.debitPaise,
								creditPaise: line.creditPaise,
							})),
						},
						context,
						by,
					),
				)
			: null;

		// 3. The old books locked up to the last day, every part.
		const locks = await this.periods.list();
		await this.periods.save(
			plan.months.flatMap((month) =>
				PARTS.filter(
					(part) => !locks.some((l) => l.month === month && l.part === part && l.state === 'locked'),
				).map((part) => ({
					month,
					part,
					state: 'locked' as const,
					reason: `Converted to ${write.kind}`,
					by,
					at: now,
				})),
			),
		);

		// 4. The kind changes (only Convert may), and the new kind's templates are recorded as installed.
		await this.company.saveProfile({ ...profile, kind: write.kind, updatedAt: now }, profile.updatedAt);
		await this.templates.installUnlocked(by);
		await this.audit.append({
			id: `aud_${randomUUID()}`,
			actorUserId: by,
			targetUserId: null,
			audience: 'admin',
			action: 'company.convert',
			entityType: 'company',
			entityId: null,
			severity: 'info',
			retentionTier: 'books',
			diffs: [{ field: 'kind', before: profile.kind, after: write.kind }],
			metadata: { lastDay: write.lastDay, voucherId: voucher?.id ?? null, months: plan.months.length },
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: now,
		});
		return { voucherId: voucher?.id ?? null, months: plan.months.length };
	}
}

@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/company/convert')
export class ConvertController {
	constructor(private readonly convert: ConvertService) {}

	@Get('preview')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts_template.edit')
	@ApiOperation({ operationId: 'convertPreview', summary: 'What converting to another kind would do' })
	preview(
		@Query(new ZodValidationPipe(ConvertQuery)) query: ConvertQuery,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.convert.preview(query, principal);
	}

	@Post()
	@RequirePermissions('accounts_template.edit')
	@ApiOperation({ operationId: 'convert', summary: 'Convert to another kind of business' })
	run(
		@Body(new ZodValidationPipe(ConvertWrite)) body: ConvertWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.convert.convert(body, principal);
	}
}
