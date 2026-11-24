import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	Body,
	Controller,
	Get,
	Header,
	Inject,
	Injectable,
	NotFoundException,
	Param,
	Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BooksImport, ImportBringIn, ImportInput, VoucherKind, type ImportPreview } from '@saha-textile/contracts';
import {
	importCheck,
	matchLedgers,
	openingLines,
	parseTallyMasters,
	parseTemplateCsv,
	type AuditLogRepository,
	type BooksImportRepository,
	type GeneralLedgerRepository,
	type ImportedLedger,
	type LedgerMatch,
	type LocationRepository,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
	AUDIT_LOG_REPOSITORY,
	BOOKS_IMPORT_REPOSITORY,
	GENERAL_LEDGER_REPOSITORY,
	LOCATION_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';
import { accountsRefusal } from './accounts-refusal';
import { LedgerService } from './ledger.service';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));
const dayBefore = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** The file read into ledgers: a Tally masters export, or a trial balance in our template's columns. */
export function readFile(input: Pick<ImportInput, 'source' | 'text'>): ImportedLedger[] {
	return input.source === 'tally_xml' ? parseTallyMasters(input.text) : parseTemplateCsv(input.text);
}

/** The person's choices laid over the matches: a ledger chosen, or a group to make a new ledger in. */
export function applyChoices(matches: readonly LedgerMatch[], choices: ImportBringIn['choices']): LedgerMatch[] {
	const chosen = new Map(choices.map((c) => [c.name, c]));
	return matches.map((m) => {
		const c = chosen.get(m.name);
		if (!c || (!c.ledgerId && !c.groupKey)) return m;
		return c.ledgerId
			? { ...m, how: 'by_name', ledgerId: c.ledgerId, groupKey: null }
			: { ...m, how: 'new', ledgerId: null, groupKey: c.groupKey };
	});
}

/**
 * Bring your books in (accounts brief I1, W1–W3): a TallyPrime masters export or a trial balance in our template read
 * into ledgers, matched to ours, checked, then brought in as one opening journal dated the day before the books start,
 * with the new ledgers made first. Nothing is saved until "Bring in"; the import can be undone (super admin) until
 * the next entry is posted.
 */
@Injectable()
export class BooksImportService {
	constructor(
		@Inject(BOOKS_IMPORT_REPOSITORY) private readonly store: BooksImportRepository,
		@Inject(GENERAL_LEDGER_REPOSITORY) private readonly books: Pick<GeneralLedgerRepository, 'listVouchers'>,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'get'>,
		@Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: Pick<AuditLogRepository, 'append'>,
		@Inject(LedgerService)
		private readonly ledger: Pick<LedgerService, 'chart' | 'addLedger' | 'post' | 'reverse'>,
	) {}

	private read(input: Pick<ImportInput, 'source' | 'text'>): ImportedLedger[] {
		const rows = readFile(input);
		if (!rows.length) throw refuse('import_nothing_read');
		return rows;
	}

	private preview(rows: readonly ImportedLedger[], matches: readonly LedgerMatch[]): ImportPreview {
		const check = importCheck(rows, matches);
		return {
			rows: rows.map((r, i) => ({ ...r, ...(matches[i] as LedgerMatch) })),
			matched: matches.filter((m) => m.how !== 'choose').length,
			toCheck: matches.filter((m) => m.how === 'choose' || m.how === 'new').length,
			...check,
		};
	}

	/** W2–W3: what the file holds, where each ledger goes, and the checks. Nothing is saved. */
	async check(input: ImportInput): Promise<ImportPreview> {
		const rows = this.read(input);
		return this.preview(rows, matchLedgers(rows, await this.ledger.chart()));
	}

	private async voucherCount(): Promise<number> {
		const found = await this.books.listVouchers({
			from: '0001-01-01',
			to: '9999-12-31',
			kinds: VoucherKind.options,
			search: '',
			page: 1,
			pageSize: 1,
		});
		return found.total;
	}

	/** W3 Bring in: new ledgers made, then one opening journal in one transaction. */
	async bringIn(write: ImportBringIn, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		const rows = this.read(write);
		const chart = await this.ledger.chart();
		const matches = applyChoices(matchLedgers(rows, chart), write.choices);
		const preview = this.preview(rows, matches);
		if (preview.toChoose) throw refuse('import_ledgers_to_choose');
		if (!preview.balanced) throw refuse('import_not_balanced');
		if (!preview.debitPaise) throw refuse('import_nothing_to_bring');
		if (!(await this.locations.get(write.locationId))) throw refuse('location_unknown');
		const by = principal?.userId ?? null;
		const vouchersAtImport = await this.voucherCount();
		const made: string[] = [];
		const ids: (string | null)[] = [];
		for (const [i, m] of matches.entries()) {
			const row = rows[i] as ImportedLedger;
			if (m.ledgerId || !m.groupKey || !row.openingPaise) {
				ids.push(m.ledgerId);
				continue;
			}
			const group = chart.groups.find((g) => g.systemKey === m.groupKey);
			if (!group) throw refuse('import_group_unknown');
			const ledger = await this.ledger.addLedger(
				{ name: row.name, groupId: group.id, active: true, expectedUpdatedAt: null },
				by,
			);
			made.push(ledger.id);
			ids.push(ledger.id);
		}
		const id = `imp_${randomUUID()}`;
		const lines = openingLines(
			rows,
			ids,
			matches.map((m) => m.how === 'party'),
		);
		const voucher = await this.transactions.withTransaction((context) =>
			this.ledger.post(
				{
					kind: 'journal',
					date: dayBefore(write.startOn),
					narration: `Opening balances brought in${write.fileName ? ` from ${write.fileName}` : ''}`,
					source: { type: 'import', id, number: null },
					idempotencyKey: `booksImport:${id}`,
					lines: lines.map(({ ledgerId, ...rest }) => ({
						ledger: { id: ledgerId },
						locationId: write.locationId,
						...rest,
					})),
				},
				context,
				by,
			),
		);
		const entry: BooksImport & { vouchersAtImport: number } = {
			id,
			source: write.source,
			fileName: write.fileName,
			startOn: write.startOn,
			locationId: write.locationId,
			voucherId: voucher.id,
			ledgersMade: made,
			debitPaise: preview.debitPaise,
			createdBy: by,
			createdAt: now.toISOString(),
			undoneAt: null,
			undoneBy: null,
			vouchersAtImport,
		};
		await this.store.save(entry);
		await this.log('accounts.import', by, id, { source: write.source, ledgers: rows.length, made: made.length });
		return entry;
	}

	private log(action: string, by: string | null, id: string, metadata: Record<string, unknown>) {
		return this.audit.append({
			id: `aud_${randomUUID()}`,
			actorUserId: by,
			targetUserId: null,
			audience: 'admin',
			action,
			entityType: 'booksImport',
			entityId: id,
			severity: 'info',
			retentionTier: 'financial_security',
			diffs: [],
			metadata,
			requestId: null,
			ipHash: null,
			createdAt: new Date().toISOString(),
		} as never);
	}

	async list(): Promise<BooksImport[]> {
		return (await this.store.list()).map((entry) => BooksImport.parse(entry));
	}

	/** Undo the whole import, while nothing new has been posted since. */
	async undo(id: string, principal: AuthenticatedPrincipal | undefined, now = new Date()): Promise<BooksImport> {
		const entry = await this.store.get(id);
		if (!entry) throw new NotFoundException(accountsRefusal('import_not_found'));
		if (entry.undoneAt) throw refuse('import_undone');
		if ((await this.voucherCount()) > entry.vouchersAtImport + 1) throw refuse('import_books_in_use');
		await this.ledger.reverse(
			entry.voucherId,
			{ date: dayBefore(entry.startOn), reason: 'Import undone', idempotencyKey: `booksImportUndo:${id}` },
			principal,
		);
		const undone = { ...entry, undoneAt: now.toISOString(), undoneBy: principal?.userId ?? null };
		await this.store.save(undone);
		await this.log('accounts.import.undo', undone.undoneBy, id, {});
		return BooksImport.parse(undone);
	}
}

/** Accounts › Import (I1). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/accounts/import')
export class BooksImportController {
	constructor(private readonly imports: BooksImportService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'booksImports', summary: 'Books brought in so far (I1)' })
	list() {
		return this.imports.list();
	}

	@Post('check')
	@RequirePermissions('accounts.post')
	@ApiOperation({
		operationId: 'booksImportCheck',
		summary: 'Read a file and match its ledgers; nothing saved (W2, W3)',
	})
	check(@Body(new ZodValidationPipe(ImportInput)) body: ImportInput) {
		return this.imports.check(body);
	}

	@Post()
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'booksImportBringIn', summary: 'Bring the books in as one opening journal (W3)' })
	bringIn(
		@Body(new ZodValidationPipe(ImportBringIn)) body: ImportBringIn,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.imports.bringIn(body, principal);
	}

	@Post(':id/undo')
	@RequirePermissions('accounts.lock')
	@ApiOperation({ operationId: 'booksImportUndo', summary: 'Undo an import while nothing new is posted (W3)' })
	undo(@Param('id') id: string, @Principal() principal?: AuthenticatedPrincipal) {
		return this.imports.undo(id, principal);
	}
}
