import { Body, Controller, Get, Header, Param, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	LocationStockQuery,
	TransferCancelWrite,
	TransferDecisionWrite,
	TransferListQuery,
	TransferPackWrite,
	TransferReceiveWrite,
	TransferRequestWrite,
} from '@saha-textile/contracts';
import type { FastifyReply } from 'fastify';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { TransfersService } from './transfers.service';

/** Stock transfers between locations (accounts brief N1–N8). */
@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/transfers')
export class TransfersController {
	constructor(private readonly transfers: TransfersService) {}

	@Get('stock')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('transfer.index')
	@ApiOperation({
		operationId: 'stockByLocation',
		summary: "Each item's stock at each location, and in transit (N1)",
	})
	stock(
		@Query(new ZodValidationPipe(LocationStockQuery)) query: LocationStockQuery,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.transfers.stockByLocation(query, principal);
	}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('transfer.index')
	@ApiOperation({ operationId: 'transfers', summary: 'Transfers to and from the locations in reach (N3)' })
	list(
		@Query(new ZodValidationPipe(TransferListQuery)) query: TransferListQuery,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.transfers.list(query, principal);
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('transfer.index')
	@ApiOperation({ operationId: 'transfer', summary: 'A transfer and what this person may do with it now (N4)' })
	view(@Param('id') id: string, @Principal() principal?: AuthenticatedPrincipal) {
		return this.transfers.view(id, principal);
	}

	@Post()
	@RequirePermissions('transfer.create')
	@ApiOperation({ operationId: 'transferRequest', summary: 'Ask another location for stock (N2)' })
	request(
		@Body(new ZodValidationPipe(TransferRequestWrite)) body: TransferRequestWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.transfers.request(body, principal);
	}

	@Post(':id/decide')
	@RequirePermissions('transfer.manage')
	@ApiOperation({ operationId: 'transferDecide', summary: 'Approve (keep the pieces) or reject at the sender' })
	decide(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(TransferDecisionWrite)) body: TransferDecisionWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.transfers.decide(id, body, principal);
	}

	@Post(':id/pack')
	@RequirePermissions('transfer.manage')
	@ApiOperation({ operationId: 'transferPack', summary: 'Save the stock-out checklist, or dispatch it (N5)' })
	pack(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(TransferPackWrite)) body: TransferPackWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.transfers.pack(id, body, principal);
	}

	@Post(':id/receive')
	@RequirePermissions('transfer.manage')
	@ApiOperation({ operationId: 'transferReceive', summary: 'Receive what arrived on the stock-in checklist (N6)' })
	receive(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(TransferReceiveWrite)) body: TransferReceiveWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.transfers.receive(id, body, principal);
	}

	@Post(':id/cancel')
	@RequirePermissions('transfer.manage')
	@ApiOperation({ operationId: 'transferCancel', summary: 'Cancel a transfer before it leaves' })
	cancel(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(TransferCancelWrite)) body: TransferCancelWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.transfers.cancel(id, body, principal);
	}

	@Get(':id/print')
	@RequirePermissions('transfer.index')
	@ApiOperation({
		operationId: 'transferPrint',
		summary: 'The delivery challan, or the branch invoice to another GSTIN (PDF)',
	})
	async print(@Param('id') id: string, @Res() reply: FastifyReply, @Principal() principal?: AuthenticatedPrincipal) {
		const pdf = await this.transfers.print(id, principal);
		void reply
			.header('Content-Type', 'application/pdf')
			.header('Content-Disposition', `inline; filename="${pdf.fileName}"`)
			.header('Cache-Control', 'no-store')
			.send(Buffer.from(pdf.bytes));
	}
}
