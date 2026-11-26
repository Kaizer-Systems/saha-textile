import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { BusinessRepository, LedgerRepository } from '@saha-textile/core-domain';

import { codedRefusal } from '../common/coded-refusal';
import { previewDocument } from '../documents/document-previews';
import { DocumentFormatsService } from '../documents/document-formats.service';
import { businessReceiptData, journalData } from '../documents/record-prints';
import { BUSINESS_REPOSITORY, LEDGER_REPOSITORY } from '../infra/tokens';

const PAGE = 1000;

/** A business account's receipts (RC) and journal vouchers (JV), printed on their document formats (owner, 23 Nov). */
@Injectable()
export class BusinessDocuments {
	constructor(
		@Inject(BUSINESS_REPOSITORY) private readonly businesses: BusinessRepository,
		@Inject(LEDGER_REPOSITORY) private readonly ledger: LedgerRepository,
		@Inject(DocumentFormatsService) private readonly formats: DocumentFormatsService,
	) {}

	async pdf(businessId: string, documentId: string): Promise<{ fileName: string; data: Uint8Array }> {
		const business = await this.businesses.findById(businessId);
		if (!business) throw new NotFoundException('That business does not exist');
		const sides = await Promise.all(
			(['receivable', 'payable'] as const).map((side) =>
				this.ledger.list(businessId, side, { page: 1, pageSize: PAGE }).then((page) => page.rows),
			),
		);
		const entries = sides.flat().filter((row) => row.documentId === documentId);
		const first = entries[0];
		if (!first) throw new NotFoundException(codedRefusal('document_missing', 'No such document', 'documentId'));
		const number = (first.documentNumber ?? documentId).replace(/[^A-Za-z0-9-]+/g, '-');
		if (first.documentType === 'receipt') {
			const seller = await this.formats.seller(previewDocument('receipt').seller);
			const data = businessReceiptData(business, first, seller);
			return { fileName: `receipt-${number}.pdf`, data: await this.formats.renderActive('receipt', data) };
		}
		if (first.documentType === 'journal') {
			const seller = await this.formats.seller(previewDocument('journal').seller);
			const data = journalData(business, entries, seller);
			return { fileName: `journal-${number}.pdf`, data: await this.formats.renderActive('journal', data) };
		}
		throw new ConflictException(
			codedRefusal('document_not_printable', 'This entry prints with its own order or purchase', 'documentId'),
		);
	}
}
