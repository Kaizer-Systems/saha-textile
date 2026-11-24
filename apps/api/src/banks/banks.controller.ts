import { Body, Controller, Get, Header, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	BankAccountEdit,
	BankAccountWrite,
	BankLayoutWrite,
	BankLineLink,
	BankLineQuery,
	BookEntryQuery,
	IfscQuery,
	MatchRuleWrite,
	ReconcilePeriod,
	ReconcileQuery,
	StatementPreviewWrite,
	StatementSaveWrite,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { BanksService } from './banks.service';
import { ReconcileService } from './reconcile.service';
import { StatementsService } from './statements.service';

/** Bank accounts, their statements and reconciling them (accounts brief BA1–BA10). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/accounts/banks')
export class BanksController {
	constructor(
		private readonly banks: BanksService,
		private readonly statements: StatementsService,
		private readonly reconcile: ReconcileService,
	) {}

	@Get('matching-rules')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'bankMatchRules', summary: 'How statement lines are matched (BA10)' })
	matchRules() {
		return this.reconcile.rules();
	}

	@Put('matching-rules')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'bankMatchRuleSave', summary: 'Add or change a matching rule (BA10)' })
	saveMatchRule(
		@Body(new ZodValidationPipe(MatchRuleWrite)) body: MatchRuleWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.reconcile.saveRule(body, principal);
	}

	@Get(':id/reconcile')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'bankReconcile', summary: 'Statement lines with their suggested matches (BA7)' })
	reconcileView(@Param('id') id: string, @Query(new ZodValidationPipe(ReconcileQuery)) query: ReconcileQuery) {
		return this.reconcile.view(id, query);
	}

	@Get(':id/reconcile/entries')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({
		operationId: 'bankReconcileEntries',
		summary: 'Entries of the books a line can be linked to (BA8)',
	})
	reconcileEntries(@Param('id') id: string, @Query(new ZodValidationPipe(BookEntryQuery)) query: BookEntryQuery) {
		return this.reconcile.findEntries(id, query.q);
	}

	@Post(':id/reconcile/accept-sure')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'bankAcceptSure', summary: 'Accept every sure match in the period (BA7)' })
	acceptSure(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(ReconcilePeriod)) body: ReconcilePeriod,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.reconcile.acceptSure(id, body, principal);
	}

	@Post(':id/lines/:lineId/accept')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'bankLineAccept', summary: 'Accept a line’s suggested match (BA7)' })
	acceptLine(
		@Param('id') id: string,
		@Param('lineId') lineId: string,
		@Body(new ZodValidationPipe(ReconcilePeriod)) body: ReconcilePeriod,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.reconcile.accept(id, lineId, body, principal);
	}

	@Post(':id/lines/:lineId/reject')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'bankLineReject', summary: 'Turn down a line’s suggested match (BA7)' })
	rejectLine(
		@Param('id') id: string,
		@Param('lineId') lineId: string,
		@Body(new ZodValidationPipe(ReconcilePeriod)) body: ReconcilePeriod,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.reconcile.reject(id, lineId, body, principal);
	}

	@Post(':id/lines/:lineId/link')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'bankLineLink', summary: 'Link a line to entries that come to its amount (BA8)' })
	linkLine(
		@Param('id') id: string,
		@Param('lineId') lineId: string,
		@Body(new ZodValidationPipe(BankLineLink)) body: BankLineLink,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.reconcile.link(id, lineId, body, principal);
	}

	@Post(':id/lines/:lineId/unmatch')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'bankLineUnmatch', summary: 'Break a line’s match (BA8)' })
	unmatchLine(
		@Param('id') id: string,
		@Param('lineId') lineId: string,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.reconcile.unmatch(id, lineId, principal);
	}

	@Get('layouts')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'bankLayouts', summary: 'Saved statement layouts (BA5)' })
	layouts() {
		return this.statements.layouts();
	}

	@Put('layouts')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'bankLayoutSave', summary: 'Save a statement layout, once per bank (BA5)' })
	saveLayout(@Body(new ZodValidationPipe(BankLayoutWrite)) body: BankLayoutWrite) {
		return this.statements.saveLayout(body);
	}

	@Post(':id/lines/preview')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'bankStatementPreview', summary: 'Read a statement file’s rows by a layout (BA6)' })
	preview(@Param('id') id: string, @Body(new ZodValidationPipe(StatementPreviewWrite)) body: StatementPreviewWrite) {
		return this.statements.preview(id, body);
	}

	@Post(':id/lines')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'bankStatementSave', summary: 'Save a statement’s lines, each once (BA6)' })
	saveLines(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(StatementSaveWrite)) body: StatementSaveWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.statements.save(id, body, principal);
	}

	@Get(':id/lines')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'bankLines', summary: 'An account’s imported statement lines (BA3)' })
	lines(@Param('id') id: string, @Query(new ZodValidationPipe(BankLineQuery)) query: BankLineQuery) {
		return this.statements.lines(id, query);
	}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'bankAccounts', summary: 'Bank accounts with their balance in the books (BA1)' })
	list(@Principal() principal?: AuthenticatedPrincipal) {
		return this.banks.list(principal);
	}

	@Get('ifsc')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'bankIfsc', summary: 'The bank an IFSC names, from the app’s own list (BA2)' })
	ifsc(@Query(new ZodValidationPipe(IfscQuery)) query: IfscQuery) {
		return this.banks.ifsc(query.code);
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'bankAccount', summary: 'One bank account (BA3 Details)' })
	get(@Param('id') id: string, @Principal() principal?: AuthenticatedPrincipal) {
		return this.banks.get(id, principal);
	}

	@Post()
	@RequirePermissions('accounts.edit')
	@ApiOperation({
		operationId: 'bankAccountAdd',
		summary: 'Add a bank account: its ledger and opening balance (BA2)',
	})
	add(
		@Body(new ZodValidationPipe(BankAccountWrite)) body: BankAccountWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.banks.add(body, principal);
	}

	@Put(':id')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'bankAccountEdit', summary: 'Change a bank account’s details (BA2)' })
	edit(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(BankAccountEdit)) body: BankAccountEdit,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.banks.edit(id, body, principal);
	}
}
