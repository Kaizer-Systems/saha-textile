import { Body, Controller, Get, Header, HttpCode, Param, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CancelAndRefundWrite, RefundByHand } from '@saha-textile/contracts';
import type { FastifyReply } from 'fastify';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DocumentFormatsService } from '../documents/document-formats.service';
import { previewDocument } from '../documents/document-previews';
import { refundVoucherData } from '../documents/refund-voucher-print';
import { EditLogService } from '../ledger/edit-log';
import { API_TAGS } from '../openapi-tags';
import { RefundVouchersService } from './refund-vouchers.service';

const actorOf = (principal?: AuthenticatedPrincipal) => ({ id: principal?.userId ?? null, name: null });

/** C1: cancel a paid order and give the money back, each payment with its refund voucher. */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/orders')
export class CancelAndRefundController {
	constructor(private readonly refunds: RefundVouchersService) {}

	@Post(':id/cancel-and-refund')
	@HttpCode(200)
	@RequirePermissions('order.edit', 'refund.action')
	@ApiOperation({ operationId: 'cancelAndRefund', summary: 'Cancel a paid order before its invoice, and refund it' })
	cancelAndRefund(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(CancelAndRefundWrite)) body: CancelAndRefundWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.refunds.cancelAndRefund(id, body, actorOf(principal));
	}
}

/** C2: a refund voucher, its print and log; a refund the gateway refused is tried again or paid by hand. */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/accounts/refund-vouchers')
export class RefundVouchersController {
	constructor(
		private readonly refunds: RefundVouchersService,
		private readonly formats: DocumentFormatsService,
		private readonly editLog: EditLogService,
	) {}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'getRefundVoucher', summary: 'One refund voucher' })
	get(@Param('id') id: string) {
		return this.refunds.get(id);
	}

	@Get(':id/log')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'refundVoucherLog', summary: 'A refund voucher’s edit log' })
	async log(@Param('id') id: string) {
		await this.refunds.get(id);
		return this.editLog.entries('refundVoucher', id);
	}

	@Get(':id/pdf')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'refundVoucherPdf', summary: 'A refund voucher as a PDF' })
	async pdf(@Param('id') id: string, @Res() reply: FastifyReply, @Principal() principal?: AuthenticatedPrincipal) {
		const voucher = await this.refunds.get(id);
		const seller = await this.formats.seller(previewDocument('refundVoucher').seller);
		const pdf = await this.formats.renderActive('refundVoucher', refundVoucherData(voucher, seller));
		await this.refunds.printed(id, principal?.userId ?? null);
		void reply
			.header('Content-Type', 'application/pdf')
			.header('Content-Disposition', `inline; filename="${voucher.number.replace(/\//g, '-')}.pdf"`)
			.header('Cache-Control', 'no-store')
			.send(Buffer.from(pdf));
	}

	@Post(':id/retry')
	@HttpCode(200)
	@RequirePermissions('refund.action')
	@ApiOperation({ operationId: 'retryRefundVoucher', summary: 'Ask the gateway again (same reference)' })
	retry(@Param('id') id: string, @Principal() principal?: AuthenticatedPrincipal) {
		return this.refunds.retry(id, principal?.userId ?? null);
	}

	@Post(':id/by-hand')
	@HttpCode(200)
	@RequirePermissions('refund.action')
	@ApiOperation({ operationId: 'refundVoucherByHand', summary: 'Pay a refused refund by bank transfer instead' })
	byHand(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(RefundByHand)) body: RefundByHand,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.refunds.byHand(id, body, principal?.userId ?? null);
	}
}
