import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	BankLayout,
	BankLayoutWrite,
	BankLine,
	BankLineQuery,
	BankLinePage,
	StatementPreview,
	StatementPreviewWrite,
	StatementSaveWrite,
} from '@saha-textile/contracts';
import {
	lineKey,
	statementLines,
	statementTotals,
	type BankRepository,
	type BankStatementRepository,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { BANK_REPOSITORY, BANK_STATEMENT_REPOSITORY, TRANSACTION_MANAGER } from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));

/**
 * Bank statements (accounts brief BA4–BA6): a bank's layout is matched once and saved; a statement file's rows are
 * read by it into lines, each marked when already imported; the lines, corrected where needed, are saved only when
 * the statement's opening plus its lines come to its closing, each line once per account.
 */
@Injectable()
export class StatementsService {
	constructor(
		@Inject(BANK_STATEMENT_REPOSITORY) private readonly repo: BankStatementRepository,
		@Inject(BANK_REPOSITORY) private readonly banks: Pick<BankRepository, 'get'>,
		@Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManagerPort,
	) {}

	layouts(): Promise<BankLayout[]> {
		return this.repo.layouts();
	}

	async saveLayout(write: BankLayoutWrite, now = new Date()): Promise<BankLayout> {
		const columns = write.columns;
		const money =
			write.money === 'split'
				? columns.withdrawal !== null && columns.deposit !== null
				: columns.amount !== null && columns.drcr !== null;
		if (columns.date === null || columns.description === null || !money) throw refuse('bank_layout_incomplete');
		const layout: BankLayout = { ...write, id: write.id ?? `lay_${randomUUID()}`, updatedAt: now.toISOString() };
		await this.repo.saveLayout(layout);
		return layout;
	}

	private async account(id: string) {
		const account = await this.banks.get(id);
		if (!account) throw new NotFoundException(accountsRefusal('bank_account_not_found'));
		return account;
	}

	/** BA6's first look: the rows read by the layout, each line marked when the account already holds it. */
	async preview(id: string, write: StatementPreviewWrite): Promise<StatementPreview> {
		await this.account(id);
		const layout = (await this.repo.layouts()).find((l) => l.id === write.layoutId);
		if (!layout) throw refuse('bank_layout_unknown');
		const read = statementLines(write.rows, layout);
		const held = await this.repo.keysIn(id, read.lines.map(lineKey));
		return {
			lines: read.lines.map((line) => ({ ...line, already: held.has(lineKey(line)) })),
			problems: read.problems,
		};
	}

	/** "Save the lines": only when opening plus lines is the closing; lines held before are skipped. */
	async save(id: string, write: StatementSaveWrite, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		await this.account(id);
		const totals = statementTotals(write.openingPaise, write.lines, write.closingPaise);
		if (!totals.matches) throw refuse(`statement_totals_differ:${totals.computedPaise}`);
		const held = await this.repo.keysIn(id, write.lines.map(lineKey));
		const at = now.toISOString();
		const importId = `imp_${randomUUID()}`;
		const fresh: BankLine[] = [];
		const seen = new Set<string>();
		for (const line of write.lines) {
			const key = lineKey(line);
			if (held.has(key) || seen.has(key)) continue;
			seen.add(key);
			fresh.push({
				...line,
				id: `bl_${randomUUID()}`,
				bankAccountId: id,
				key,
				importId,
				status: 'unmatched',
				match: null,
				rejectedKeys: [],
				createdAt: at,
			});
		}
		const lastDate = write.lines.reduce((last, l) => (l.date > last ? l.date : last), '');
		return this.tx.withTransaction(async (context) => {
			if (fresh.length) await this.repo.insertLines(fresh, context);
			const entry = {
				id: importId,
				bankAccountId: id,
				fileName: write.fileName,
				openingPaise: write.openingPaise,
				closingPaise: write.closingPaise,
				saved: fresh.length,
				skipped: write.lines.length - fresh.length,
				lastDate,
				at,
				by: principal?.userId ?? null,
			};
			await this.repo.insertImport(entry, context);
			return entry;
		});
	}

	lines(id: string, query: BankLineQuery): Promise<BankLinePage> {
		return this.repo.lines(id, query);
	}
}
