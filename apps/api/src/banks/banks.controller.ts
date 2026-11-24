import { Body, Controller, Get, Header, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	BankAccountEdit,
	BankAccountWrite,
	BankLayoutWrite,
	BankLineQuery,
	IfscQuery,
	StatementPreviewWrite,
	StatementSaveWrite,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { BanksService } from './banks.service';
import { StatementsService } from './statements.service';

/** Bank accounts (accounts brief BA1–BA3). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/accounts/banks')
export class BanksController {
	constructor(
		private readonly banks: BanksService,
		private readonly statements: StatementsService,
	) {}

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
