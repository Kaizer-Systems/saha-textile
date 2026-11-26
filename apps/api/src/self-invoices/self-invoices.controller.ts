import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	PaymentVoucherCancel,
	PaymentVoucherListQuery,
	SelfInvoiceCancel,
	SelfInvoiceFormQuery,
	SelfInvoiceIssue,
	SelfInvoiceListQuery,
	SelfInvoicePayWrite,
	SelfInvoiceWrite,
	SupplierPaymentWrite,
} from '@saha-textile/contracts';
import type { FastifyReply } from 'fastify';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DocumentFormatsService } from '../documents/document-formats.service';
import { previewDocument } from '../documents/document-previews';
import { paymentVoucherData, selfInvoiceData } from '../documents/self-invoice-print';
import { EditLogService } from '../ledger/edit-log';
import { API_TAGS } from '../openapi-tags';
import { SelfInvoicesService } from './self-invoices.service';

const pdfName = (number: string) => `inline; filename="${number.replace(/\//g, '-')}.pdf"`;

/** Accounts › Self-invoices (accounts brief D2, D3): reverse-charge supplies, their prints, logs and payments. */
@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/accounts/self-invoices')
export class SelfInvoicesController {
	constructor(
		private readonly selfInvoices: SelfInvoicesService,
		private readonly formats: DocumentFormatsService,
		private readonly editLog: EditLogService,
	) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({
		operationId: 'listSelfInvoices',
		summary: 'Self-invoices by the day received, with every chip counted',
	})
	list(@Query(new ZodValidationPipe(SelfInvoiceListQuery)) query: SelfInvoiceListQuery) {
		return this.selfInvoices.list(query);
	}

	@Get('form')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'selfInvoiceForm', summary: 'Suppliers without a GSTIN and the reverse-charge list' })
	form(
		@Query(new ZodValidationPipe(SelfInvoiceFormQuery)) query: SelfInvoiceFormQuery,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.selfInvoices.form(query.receivedOn, principal);
	}

	@Post()
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'createSelfInvoice', summary: 'Save a reverse-charge supply as a draft' })
	create(
		@Body(new ZodValidationPipe(SelfInvoiceWrite)) body: SelfInvoiceWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.selfInvoices.create(body, principal);
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'getSelfInvoice', summary: 'One self-invoice' })
	get(@Param('id') id: string) {
		return this.selfInvoices.get(id);
	}

	@Put(':id')
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'saveSelfInvoice', summary: 'Save a draft self-invoice' })
	save(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(SelfInvoiceWrite)) body: SelfInvoiceWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.selfInvoices.save(id, body, principal);
	}

	@Delete(':id')
	@HttpCode(204)
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'deleteSelfInvoice', summary: 'Delete a draft self-invoice' })
	async remove(@Param('id') id: string, @Principal() principal?: AuthenticatedPrincipal) {
		await this.selfInvoices.remove(id, principal);
	}

	@Post(':id/issue')
	@HttpCode(200)
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'issueSelfInvoice', summary: 'Issue a self-invoice (SI number and posting)' })
	issue(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(SelfInvoiceIssue)) body: SelfInvoiceIssue,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.selfInvoices.issue(id, body.version, principal);
	}

	@Post(':id/pay')
	@HttpCode(200)
	@RequirePermissions('purchase.payment')
	@ApiOperation({ operationId: 'paySelfInvoice', summary: 'Pay the supplier and issue the payment voucher' })
	pay(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(SelfInvoicePayWrite)) body: SelfInvoicePayWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.selfInvoices.pay(id, body, principal);
	}

	@Post(':id/cancel')
	@HttpCode(200)
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'cancelSelfInvoice', summary: 'Cancel an unpaid self-invoice (super admin)' })
	cancel(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(SelfInvoiceCancel)) body: SelfInvoiceCancel,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.selfInvoices.cancel(id, body, principal);
	}

	@Get(':id/payment-vouchers')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'selfInvoicePaymentVouchers', summary: 'The payment vouchers of a self-invoice' })
	async paymentVouchers(@Param('id') id: string) {
		await this.selfInvoices.get(id);
		return this.selfInvoices.paymentVouchersFor('selfInvoice', id);
	}

	@Get(':id/log')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'selfInvoiceLog', summary: 'A self-invoice’s edit log' })
	async log(@Param('id') id: string) {
		await this.selfInvoices.get(id);
		return this.editLog.entries('selfInvoice', id);
	}

	@Get(':id/pdf')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'selfInvoicePdf', summary: 'A self-invoice as a PDF' })
	async pdf(@Param('id') id: string, @Res() reply: FastifyReply, @Principal() principal?: AuthenticatedPrincipal) {
		const invoice = await this.selfInvoices.get(id);
		const seller = await this.formats.seller(previewDocument('selfInvoice').seller);
		const pdf = await this.formats.renderActive('selfInvoice', selfInvoiceData(invoice, seller));
		await this.selfInvoices.printed('selfInvoice', id, principal?.userId ?? null);
		void reply
			.header('Content-Type', 'application/pdf')
			.header('Content-Disposition', pdfName(invoice.number ?? 'self-invoice-draft'))
			.header('Cache-Control', 'no-store')
			.send(Buffer.from(pdf));
	}
}

/** Payment vouchers (decision D5): one per payment to a supplier, with its print and log. */
@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/accounts/payment-vouchers')
export class PaymentVouchersController {
	constructor(
		private readonly selfInvoices: SelfInvoicesService,
		private readonly formats: DocumentFormatsService,
		private readonly editLog: EditLogService,
	) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'listPaymentVouchers', summary: 'Payment vouchers by date, with every chip counted' })
	list(@Query(new ZodValidationPipe(PaymentVoucherListQuery)) query: PaymentVoucherListQuery) {
		return this.selfInvoices.listPaymentVouchers(query);
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'getPaymentVoucher', summary: 'One payment voucher' })
	get(@Param('id') id: string) {
		return this.selfInvoices.paymentVoucher(id);
	}

	@Get(':id/log')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'paymentVoucherLog', summary: 'A payment voucher’s edit log' })
	async log(@Param('id') id: string) {
		await this.selfInvoices.paymentVoucher(id);
		return this.editLog.entries('paymentVoucher', id);
	}

	@Post(':id/cancel')
	@HttpCode(200)
	@RequirePermissions('purchase.payment')
	@ApiOperation({
		operationId: 'cancelPaymentVoucher',
		summary: 'Cancel a payment voucher (super admin, month open)',
	})
	cancel(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(PaymentVoucherCancel)) body: PaymentVoucherCancel,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.selfInvoices.cancelPaymentVoucher(id, body, principal);
	}

	@Get(':id/pdf')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'paymentVoucherPdf', summary: 'A payment voucher as a PDF' })
	async pdf(@Param('id') id: string, @Res() reply: FastifyReply, @Principal() principal?: AuthenticatedPrincipal) {
		const voucher = await this.selfInvoices.paymentVoucher(id);
		const seller = await this.formats.seller(previewDocument('paymentVoucher').seller);
		const pdf = await this.formats.renderActive('paymentVoucher', paymentVoucherData(voucher, seller));
		await this.selfInvoices.printed('paymentVoucher', id, principal?.userId ?? null);
		void reply
			.header('Content-Type', 'application/pdf')
			.header('Content-Disposition', pdfName(voucher.number))
			.header('Cache-Control', 'no-store')
			.send(Buffer.from(pdf));
	}
}

/** D4: Record payment on a purchase entry, with its own payment voucher (decision D5). */
@ApiTags(API_TAGS.purchases)
@Audience('admin')
@Controller('admin/purchases/entries')
export class PurchasePaymentVouchersController {
	constructor(private readonly selfInvoices: SelfInvoicesService) {}

	@Post(':id/pay-with-voucher')
	@HttpCode(200)
	@RequirePermissions('purchase.payment')
	@ApiOperation({ operationId: 'payPurchaseEntryWithVoucher', summary: 'Record a payment and issue its voucher' })
	pay(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(SupplierPaymentWrite)) body: SupplierPaymentWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.selfInvoices.payPurchaseEntry(id, body, principal);
	}

	@Get(':id/payment-vouchers')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('purchase.index')
	@ApiOperation({ operationId: 'purchaseEntryPaymentVouchers', summary: 'The payment vouchers of a purchase entry' })
	paymentVouchers(@Param('id') id: string) {
		return this.selfInvoices.paymentVouchersFor('purchaseEntry', id);
	}
}
