import { Body, Controller, Get, Header, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BankAccountWrite } from '@saha-textile/contracts';
import { z } from 'zod';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { BanksService } from './banks.service';

const BankAccountEdit = BankAccountWrite.extend({ version: z.number().int().nonnegative() });
const IfscQuery = z.object({ code: z.string().trim().min(4).max(11) });

/** Bank accounts (accounts brief BA1–BA3). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/accounts/banks')
export class BanksController {
	constructor(private readonly banks: BanksService) {}

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
	ifsc(@Query(new ZodValidationPipe(IfscQuery)) query: z.infer<typeof IfscQuery>) {
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
		@Body(new ZodValidationPipe(BankAccountEdit)) body: z.infer<typeof BankAccountEdit>,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.banks.edit(id, body, principal);
	}
}
