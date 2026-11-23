import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	AccountGroupWrite,
	AccountStatementSearch,
	DocumentLockTarget,
	JournalVoucherWrite,
	LedgerWrite,
	PeriodLockWrite,
	VoucherListQuery,
	VoucherReverse,
} from '@saha-textile/contracts';
import type { z } from 'zod';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { LedgerService } from './ledger.service';

const by = (principal: AuthenticatedPrincipal | undefined): string | null => principal?.userId ?? null;

/** Accounts › Chart of accounts, vouchers, ledgers, periods (accounts brief Q1–Q3, T1–T2). */
@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/accounts')
export class LedgerController {
	constructor(private readonly ledger: LedgerService) {}

	@Get('chart')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'chartOfAccounts', summary: 'Groups and ledgers, made for the kind of business' })
	chart() {
		return this.ledger.chart();
	}

	@Post('chart/groups')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'addAccountGroup', summary: 'Add a group under another' })
	addGroup(
		@Body(new ZodValidationPipe(AccountGroupWrite)) body: AccountGroupWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.ledger.addGroup(body, by(principal));
	}

	@Post('chart/ledgers')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'addLedger', summary: 'Add a ledger to a group' })
	addLedger(
		@Body(new ZodValidationPipe(LedgerWrite)) body: LedgerWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.ledger.addLedger(body, by(principal));
	}

	@Put('chart/ledgers/:id')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'saveLedger', summary: 'Rename, move or switch off a ledger over the copy read' })
	saveLedger(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(LedgerWrite)) body: LedgerWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.ledger.saveLedger(id, body, by(principal));
	}

	@Get('ledgers/:id/statement')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'ledgerStatement', summary: 'Opening, entries with a running balance, closing' })
	statement(
		@Param('id') id: string,
		@Query(new ZodValidationPipe(AccountStatementSearch)) query: z.infer<typeof AccountStatementSearch>,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.ledger.statement(id, query, principal);
	}

	@Get('vouchers')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'listVouchers', summary: 'Vouchers in a period, newest first' })
	vouchers(@Query(new ZodValidationPipe(VoucherListQuery)) query: VoucherListQuery) {
		return this.ledger.vouchers(query);
	}

	@Get('vouchers/:id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'getVoucher', summary: 'One voucher with its lines' })
	voucher(@Param('id') id: string) {
		return this.ledger.voucher(id);
	}

	@Post('vouchers')
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'postVoucher', summary: 'Post a journal, receipt, payment or contra typed by hand' })
	post(
		@Body(new ZodValidationPipe(JournalVoucherWrite)) body: JournalVoucherWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.ledger.postByHand(body, principal);
	}

	@Post('vouchers/:id/reverse')
	@HttpCode(200)
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'reverseVoucher', summary: 'Undo a posted voucher on a date (super admin)' })
	reverse(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(VoucherReverse)) body: VoucherReverse,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.ledger.reverse(id, body, principal);
	}

	@Get('periods')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'periodGrid', summary: 'Months of this year and the last, each part’s state' })
	periods() {
		return this.ledger.periodGrid();
	}

	@Post('periods')
	@HttpCode(200)
	@RequirePermissions('accounts.lock')
	@ApiOperation({ operationId: 'lockPeriods', summary: 'Close or lock months, part by part, with a reason' })
	lock(
		@Body(new ZodValidationPipe(PeriodLockWrite)) body: PeriodLockWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.ledger.lockPeriods(body, principal);
	}
}

/** Who is editing a document (D10): open to every admin user; the page reports in every 20 seconds. */
@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/document-locks')
export class DocumentLocksController {
	constructor(private readonly ledger: LedgerService) {}

	@Post()
	@HttpCode(200)
	@ApiOperation({ operationId: 'lockDocument', summary: 'Take a document for editing, or learn who holds it' })
	lock(
		@Body(new ZodValidationPipe(DocumentLockTarget)) body: DocumentLockTarget,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.ledger.lockDocument(body.documentType, body.documentId, principal);
	}

	@Post('heartbeat')
	@HttpCode(200)
	@ApiOperation({ operationId: 'touchDocumentLock', summary: 'Keep a held document lock alive' })
	touch(
		@Body(new ZodValidationPipe(DocumentLockTarget)) body: DocumentLockTarget,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.ledger.touchDocument(body.documentType, body.documentId, principal);
	}

	@Post('take-over')
	@HttpCode(200)
	@ApiOperation({ operationId: 'takeOverDocumentLock', summary: 'Take a document from its holder (super admin)' })
	takeOver(
		@Body(new ZodValidationPipe(DocumentLockTarget)) body: DocumentLockTarget,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.ledger.takeOverDocument(body.documentType, body.documentId, principal);
	}

	@Delete(':documentType/:documentId')
	@HttpCode(204)
	@ApiOperation({ operationId: 'releaseDocumentLock', summary: 'Let a held document go' })
	async release(
		@Param('documentType') documentType: string,
		@Param('documentId') documentId: string,
		@Principal() principal?: AuthenticatedPrincipal,
	): Promise<void> {
		await this.ledger.releaseDocument(documentType, documentId, principal);
	}
}
