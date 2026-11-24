import { Body, Controller, Get, Header, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	CashCountWrite,
	CashMoveWrite,
	CashSettingsWrite,
	CashSettleWrite,
	CashSheetListQuery,
	CashTodayQuery,
	ClaimDecisionWrite,
	ClaimListQuery,
	ExpenseClaimWrite,
	OpenSheetWrite,
	PettyCheckQuery,
	PettyExpenseWrite,
	PettyListQuery,
	RefillWrite,
	SubmitDifferenceWrite,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { CashService } from './cash.service';
import { ClaimsService } from './claims.service';
import { PettyService } from './petty.service';

/**
 * Cash (accounts brief O1–O14): Settings › Cash boxes, today's sheet and its counts, moves, the list of sheets,
 * settling a difference, petty expenses and refills, and staff expense claims.
 */
@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/cash')
export class CashController {
	constructor(
		private readonly cash: CashService,
		private readonly petty: PettyService,
		private readonly claims: ClaimsService,
	) {}

	@Get('settings')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('cash.settings')
	@ApiOperation({ operationId: 'cashSettings', summary: 'Cash boxes, the notes and coins counted, and the rules' })
	settings() {
		return this.cash.settingsView();
	}

	@Put('settings')
	@RequirePermissions('cash.settings')
	@ApiOperation({ operationId: 'saveCashSettings', summary: 'Save the cash boxes, notes and coins, and rules' })
	saveSettings(
		@Body(new ZodValidationPipe(CashSettingsWrite)) body: CashSettingsWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.cash.saveSettings(body, principal?.userId ?? null);
	}

	@Get('choices')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('cash.index')
	@ApiOperation({ operationId: 'cashChoices', summary: 'Boxes, banks, petty heads and staff a cash screen offers' })
	choices(@Principal() principal?: AuthenticatedPrincipal) {
		return this.cash.choices(principal);
	}

	@Get('today')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('cash.index')
	@ApiOperation({ operationId: 'cashToday', summary: "Today's sheet of a box, or what stands in the way of one" })
	today(
		@Query(new ZodValidationPipe(CashTodayQuery)) query: CashTodayQuery,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.cash.today(query.boxId, principal);
	}

	@Get('sheets')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('cash.index')
	@ApiOperation({ operationId: 'listCashSheets', summary: 'Every box and day, with every chip counted' })
	list(
		@Query(new ZodValidationPipe(CashSheetListQuery)) query: CashSheetListQuery,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.cash.list(query, principal);
	}

	@Post('sheets')
	@RequirePermissions('cash.count')
	@ApiOperation({ operationId: 'openCashSheet', summary: 'Open a sheet by counting the float' })
	open(
		@Body(new ZodValidationPipe(OpenSheetWrite)) body: OpenSheetWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.cash.open(body, principal);
	}

	@Get('sheets/:id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('cash.index')
	@ApiOperation({ operationId: 'getCashSheet', summary: 'One sheet; amounts only for a manager while it is open' })
	view(@Param('id') id: string, @Principal() principal?: AuthenticatedPrincipal) {
		return this.cash.view(id, principal);
	}

	@Post('sheets/:id/count')
	@HttpCode(200)
	@RequirePermissions('cash.count')
	@ApiOperation({
		operationId: 'countCashSheet',
		summary: 'A close count; the answer never says how much or which way',
	})
	count(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(CashCountWrite)) body: CashCountWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.cash.count(id, body, principal);
	}

	@Post('sheets/:id/submit-difference')
	@HttpCode(200)
	@RequirePermissions('cash.count')
	@ApiOperation({ operationId: 'submitCashDifference', summary: 'Close a sheet with a difference, for a manager' })
	submitDifference(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(SubmitDifferenceWrite)) _body: unknown,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.cash.submitDifference(id, principal);
	}

	@Post('sheets/:id/moves')
	@RequirePermissions('cash.count')
	@ApiOperation({ operationId: 'moveCash', summary: 'A bank deposit, cash from the bank, or a move to another box' })
	move(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(CashMoveWrite)) body: CashMoveWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.cash.move(id, body, principal);
	}

	@Post('sheets/:id/settle')
	@HttpCode(200)
	@RequirePermissions('cash.manage')
	@ApiOperation({ operationId: 'settleCashDifference', summary: 'Settle a difference in one of the ten ways' })
	settle(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(CashSettleWrite)) body: CashSettleWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.cash.settle(id, body, principal);
	}

	@Post('suspense/release')
	@HttpCode(200)
	@RequirePermissions('cash.manage')
	@ApiOperation({ operationId: 'releaseCashSuspense', summary: 'Let unexplained excess go to other income when due' })
	async releaseSuspense() {
		return { released: await this.cash.releaseSuspense() };
	}

	@Get('petty/check')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('cash.count')
	@ApiOperation({ operationId: 'checkPettyExpense', summary: "A petty expense's checks before it is paid" })
	checkPetty(
		@Query(new ZodValidationPipe(PettyCheckQuery)) query: PettyCheckQuery,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.petty.check(query.boxId, query.paidTo, query.amountPaise, principal);
	}

	@Get('petty')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('cash.index')
	@ApiOperation({ operationId: 'listPettyExpenses', summary: 'Petty expenses in a period' })
	listPetty(
		@Query(new ZodValidationPipe(PettyListQuery)) query: PettyListQuery,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.petty.list(query, principal);
	}

	@Post('petty')
	@RequirePermissions('cash.count')
	@ApiOperation({ operationId: 'payPettyExpense', summary: 'Pay a petty expense from a box with its sheet open' })
	pay(
		@Body(new ZodValidationPipe(PettyExpenseWrite)) body: PettyExpenseWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.petty.pay(body, principal);
	}

	@Get('boxes/:id/refill')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('cash.manage')
	@ApiOperation({ operationId: 'pettyRefillPreview', summary: 'What a fixed float spent since its last refill' })
	refillPreview(@Param('id') id: string, @Principal() principal?: AuthenticatedPrincipal) {
		return this.petty.refillPreview(id, principal);
	}

	@Post('boxes/:id/refill')
	@HttpCode(200)
	@RequirePermissions('cash.manage')
	@ApiOperation({ operationId: 'refillPettyCash', summary: 'Refill a fixed float from a bank' })
	refill(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(RefillWrite)) body: RefillWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.petty.refill(id, body, principal);
	}

	@Get('claims')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('cash.index')
	@ApiOperation({ operationId: 'listExpenseClaims', summary: 'Staff expense claims, with every chip counted' })
	listClaims(
		@Query(new ZodValidationPipe(ClaimListQuery)) query: ClaimListQuery,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.claims.list(query, principal);
	}

	@Post('claims')
	@RequirePermissions('expense_claim.create')
	@ApiOperation({ operationId: 'createExpenseClaim', summary: 'A staff member’s own-pocket spend with its bill' })
	createClaim(
		@Body(new ZodValidationPipe(ExpenseClaimWrite)) body: ExpenseClaimWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.claims.create(body, principal);
	}

	@Get('claims/:id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('cash.index')
	@ApiOperation({ operationId: 'getExpenseClaim', summary: 'One expense claim' })
	getClaim(@Param('id') id: string, @Principal() principal?: AuthenticatedPrincipal) {
		return this.claims.get(id, principal);
	}

	@Post('claims/:id/decide')
	@HttpCode(200)
	@RequirePermissions('cash.manage')
	@ApiOperation({ operationId: 'decideExpenseClaim', summary: 'Approve (and pay back) or reject an expense claim' })
	decide(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(ClaimDecisionWrite)) body: ClaimDecisionWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.claims.decide(id, body, principal);
	}
}
