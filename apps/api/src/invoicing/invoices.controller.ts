import { Controller, Get, Header, Inject, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InvoiceCopy } from '@saha-textile/contracts';
import type { EDocRepository } from '@saha-textile/core-domain';
import type { FastifyReply } from 'fastify';
import { renderSVG } from 'uqr';

import { Audience, RequirePermissions } from '../auth/session.guard';
import { DocumentFormatsService } from '../documents/document-formats.service';
import { previewDocument } from '../documents/document-previews';
import { type InvoiceEDocs, taxInvoiceData } from '../documents/tax-invoice-print';
import { EDOC_REPOSITORY } from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';
import { InvoicesService } from './invoices.service';

/** An order's tax invoices and their prints (accounts brief D1; copies per Rule 48, AE5). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/orders/:id/invoices')
export class InvoicesController {
	constructor(
		private readonly invoices: InvoicesService,
		private readonly formats: DocumentFormatsService,
		@Inject(EDOC_REPOSITORY) private readonly edocs: Pick<EDocRepository, 'findActive'>,
	) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('order.index')
	@ApiOperation({ operationId: 'orderInvoices', summary: 'The tax invoices issued for an order' })
	list(@Param('id') id: string) {
		return this.invoices.listForOrder(id);
	}

	@Get(':invoiceId/pdf')
	@RequirePermissions('order.index')
	@ApiOperation({
		operationId: 'orderInvoicePdf',
		summary:
			'One copy of a tax invoice: original for recipient, duplicate for transporter or triplicate for supplier (PDF)',
	})
	async pdf(
		@Param('id') id: string,
		@Param('invoiceId') invoiceId: string,
		@Query('copy') copyParam: string | undefined,
		@Res() reply: FastifyReply,
	) {
		const invoice = await this.invoices.get(invoiceId);
		if (invoice.orderId !== id) throw new NotFoundException('invoice_not_found');
		// "all": the three copies one after another in one file (EI10).
		const copies: InvoiceCopy[] =
			copyParam === 'all' ? [...InvoiceCopy.options] : [InvoiceCopy.catch('original').parse(copyParam)];
		const [eInvoice, eWayBill] = await Promise.all([
			this.edocs.findActive('eInvoice', invoice.id).then((d) => d ?? this.edocs.findActive('eInvoice', id)),
			this.edocs.findActive('eWayBill', invoice.id).then((d) => d ?? this.edocs.findActive('eWayBill', id)),
		]);
		const seller = await this.formats.seller(previewDocument('taxInvoice').seller);
		const band: InvoiceEDocs | null = eInvoice?.irn
			? {
					irn: eInvoice.irn,
					ackNo: eInvoice.ackNo ?? null,
					ackDate: eInvoice.ackDate ?? null,
					signedQrSvg: eInvoice.signedQr ? renderSVG(eInvoice.signedQr, { ecc: 'M', border: 1 }) : null,
					ewayBill: eWayBill?.ewbNumber ?? null,
				}
			: eWayBill?.ewbNumber
				? { irn: null, ackNo: null, ackDate: null, signedQrSvg: null, ewayBill: eWayBill.ewbNumber }
				: null;
		const pdf = await this.formats.renderActiveCopies(
			'taxInvoice',
			copies.map((copy) => taxInvoiceData(invoice, seller, copy, band)),
		);
		const copy = copies.length > 1 ? 'all copies' : copies[0];
		void reply
			.header('Content-Type', 'application/pdf')
			.header('Content-Disposition', `inline; filename="${invoice.number.replace(/\//g, '-')} ${copy}.pdf"`)
			.header('Cache-Control', 'no-store')
			.send(Buffer.from(pdf));
	}
}
