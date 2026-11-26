import { Inject, Injectable } from '@nestjs/common';
import { type OpeningStockRepository, type StockReadRepository } from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { previewDocument } from '../documents/document-previews';
import { DocumentFormatsService } from '../documents/document-formats.service';
import { openingStockData, stockCountData } from '../documents/record-prints';
import { OPENING_STOCK_REPOSITORY, STOCK_READ_REPOSITORY } from '../infra/tokens';
import { canSeeCost, missing } from './purchasing-support';
import { StockCountsService } from './stock-counts.service';

const fileName = (kind: string, number: string) => `${kind}-${number.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`;

/** The stock count sheet and an opening-stock load, printed on their document formats (owner, 23 Nov). */
@Injectable()
export class StockPrints {
	constructor(
		@Inject(STOCK_READ_REPOSITORY) private readonly stock: StockReadRepository,
		@Inject(OPENING_STOCK_REPOSITORY) private readonly loads: OpeningStockRepository,
		private readonly counts: StockCountsService,
		@Inject(DocumentFormatsService) private readonly formats: DocumentFormatsService,
	) {}

	/** The count as this person may see it: a counter on a blind count gets no expected figures. */
	async countSheet(id: string, principal: AuthenticatedPrincipal | undefined) {
		const count = await this.counts.get(id, principal);
		const seller = await this.formats.seller(previewDocument('stockCount').seller);
		return {
			fileName: fileName('stock-count', count.number),
			data: await this.formats.renderActive('stockCount', stockCountData(count, seller)),
		};
	}

	/** One posted load; cost and value only for `stock.cost`, as on the screen. */
	async openingStock(id: string, principal: AuthenticatedPrincipal | undefined) {
		const load = (await this.loads.list()).find((row) => row.id === id);
		if (!load) throw missing('Opening stock');
		const facts = await this.stock.bySku(load.rows.map((row) => row.sku));
		const titles = new Map(
			[...facts].map(([sku, fact]) => [
				sku,
				{
					title: [fact.title['en'] ?? Object.values(fact.title)[0] ?? sku, fact.optionsLabel]
						.filter(Boolean)
						.join(' · '),
					soldBy: fact.soldBy,
				},
			]),
		);
		const seller = await this.formats.seller(previewDocument('openingStock').seller);
		const data = openingStockData(load, titles, canSeeCost(principal), seller);
		return {
			fileName: fileName('opening-stock', load.number),
			data: await this.formats.renderActive('openingStock', data),
		};
	}
}
