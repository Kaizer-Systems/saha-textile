import { Controller, Get, Inject, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	type DocumentNumberingRepository,
	type OrderRepository,
	istDay,
	renderChildNumber,
} from '@saha-textile/core-domain';
import type { FastifyReply } from 'fastify';

import { Audience, RequirePermissions } from '../auth/session.guard';
import { DOCUMENT_NUMBERING_REPOSITORY, ORDER_REPOSITORY } from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';
import { longDate } from '../purchasing/purchase-order-document';
import { previewDocument } from './document-previews';
import { DocumentFormatsService } from './document-formats.service';
import { packingSlipData } from './packing-slip';

/** An order's printed documents on their active formats (bundle builder brief E08 / F-PARCEL, approved 2026-11-22). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/orders')
export class OrderDocumentsController {
	constructor(
		private readonly formats: DocumentFormatsService,
		@Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
		@Inject(DOCUMENT_NUMBERING_REPOSITORY) private readonly numbering: DocumentNumberingRepository,
	) {}

	@Get(':id/packing-slip')
	@RequirePermissions('order.index')
	@ApiOperation({
		operationId: 'orderPackingSlip',
		summary: 'Print pack list: every piece flat with a tick box and where it came from, no prices (PDF)',
	})
	async packingSlip(@Param('id') id: string, @Res() reply: FastifyReply) {
		const order = await this.orders.findById(id);
		if (!order) throw new NotFoundException({ code: 'order_not_found' });
		const settings = await this.numbering.get();
		// One parcel per order today; a split order will number each of its parcels.
		const parcelNo = renderChildNumber(order.orderNumber, settings.parcel, 1);
		const seller = await this.formats.seller(previewDocument('packingSlip').seller);
		const data = packingSlipData(order, seller, { parcelNo, date: longDate(istDay(new Date())) });
		const pdf = await this.formats.renderActive('packingSlip', data);
		void reply
			.header('Content-Type', 'application/pdf')
			.header('Content-Disposition', `inline; filename="${parcelNo.replace(/\//g, '-')} packing slip.pdf"`)
			.header('Cache-Control', 'no-store')
			.send(Buffer.from(pdf));
	}
}
