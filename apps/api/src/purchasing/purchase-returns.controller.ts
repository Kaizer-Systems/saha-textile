import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	PurchaseReturnListQuery,
	PurchaseReturnSend,
	PurchaseReturnSettle,
	PurchaseReturnWrite,
	ReturnableQuery,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { PurchaseReturnsService } from './purchase-returns.service';
import { actorOf } from './purchasing-support';

/** Purchase returns and debit notes (r01–r04). */
@ApiTags(API_TAGS.purchases)
@Audience('admin')
@Controller('admin/purchase-returns')
export class PurchaseReturnsController {
	constructor(private readonly returns: PurchaseReturnsService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('purchase_return.index')
	@ApiOperation({
		operationId: 'listPurchaseReturns',
		summary: 'Returns and debit notes, drafts made by the goods check included',
	})
	list(@Query(new ZodValidationPipe(PurchaseReturnListQuery)) query: PurchaseReturnListQuery) {
		return this.returns.list(query);
	}

	@Get('returnable')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('purchase_return.index')
	@ApiOperation({
		operationId: 'returnableLines',
		summary: 'Per entry line: received, returned before, free to return and why',
	})
	returnable(@Query(new ZodValidationPipe(ReturnableQuery)) query: ReturnableQuery) {
		return this.returns.returnable(query.entryId, query.kind, query.holdId ?? null, query.excludeReturnId ?? null);
	}

	@Get('for-entry/:entryId')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('purchase_return.index')
	@ApiOperation({ operationId: 'purchaseReturnsForEntry', summary: "A purchase entry's returns (its Returns tab)" })
	forEntry(@Param('entryId') entryId: string) {
		return this.returns.forEntry(entryId);
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('purchase_return.index')
	@ApiOperation({ operationId: 'getPurchaseReturn', summary: 'One return' })
	get(@Param('id') id: string) {
		return this.returns.get(id);
	}

	@Get(':id/activity')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('purchase_return.index')
	@ApiOperation({ operationId: 'purchaseReturnActivity', summary: 'The audit trail in sentences' })
	activity(@Param('id') id: string) {
		return this.returns.activity(id);
	}

	@Post()
	@HttpCode(200)
	@RequirePermissions('purchase_return.create')
	@ApiOperation({
		operationId: 'createPurchaseReturn',
		summary: 'A return draft from a posted entry; quantities are capped',
	})
	create(
		@Body(new ZodValidationPipe(PurchaseReturnWrite)) body: PurchaseReturnWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.returns.create(body, actorOf(principal));
	}

	@Put(':id')
	@RequirePermissions('purchase_return.create')
	@ApiOperation({ operationId: 'updatePurchaseReturn', summary: 'Change a draft return' })
	update(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(PurchaseReturnWrite)) body: PurchaseReturnWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.returns.update(id, body, actorOf(principal));
	}

	@Delete(':id')
	@HttpCode(204)
	@RequirePermissions('purchase_return.create')
	@ApiOperation({ operationId: 'deletePurchaseReturn', summary: 'Delete a draft return' })
	remove(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.returns.remove(id, actorOf(principal));
	}

	@Post(':id/send')
	@HttpCode(200)
	@RequirePermissions('purchase_return.send')
	@ApiOperation({
		operationId: 'sendPurchaseReturn',
		summary: 'Number the debit note, take goods out of stock; never twice',
	})
	send(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(PurchaseReturnSend)) body: PurchaseReturnSend,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.returns.send(id, body, actorOf(principal));
	}

	@Post(':id/settle')
	@HttpCode(200)
	@RequirePermissions('purchase_return.settle')
	@ApiOperation({
		operationId: 'settlePurchaseReturn',
		summary: 'Credit note, refund, later bill or written off; part settlements stay open',
	})
	settle(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(PurchaseReturnSettle)) body: PurchaseReturnSettle,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.returns.settle(id, body, actorOf(principal));
	}
}
