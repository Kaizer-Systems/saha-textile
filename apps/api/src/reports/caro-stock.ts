import { Controller, Get, Header, Inject, Injectable, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CaroStockQuery, type CaroStockReport } from '@saha-textile/contracts';
import { caroClasses, type StockCountRepository } from '@saha-textile/core-domain';

import { Audience, RequirePermissions } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { STOCK_COUNT_REPOSITORY } from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';

const PAGE = 200;

/** CARO 2020 3(ii)(a) (accounts brief R1): stock counts posted in a period, each class's discrepancy against 10%. */
@Injectable()
export class CaroStockService {
	constructor(@Inject(STOCK_COUNT_REPOSITORY) private readonly counts: Pick<StockCountRepository, 'list'>) {}

	/** SC2: one location's counts when the filter names one (every-location counts are left out then). */
	async report(query: CaroStockQuery): Promise<CaroStockReport> {
		const posted = [];
		for (let page = 1; ; page += 1) {
			const found = await this.counts.list({ filter: 'posted', page, pageSize: PAGE });
			posted.push(...found.items);
			if (found.items.length < PAGE) break;
		}
		const counts = posted
			.filter((c) => c.postedAt && c.postedAt.slice(0, 10) >= query.from && c.postedAt.slice(0, 10) <= query.to)
			.filter((c) => !query.locationId || c.locationId === query.locationId)
			.map((c) => ({
				id: c.id,
				number: c.number,
				label: c.label,
				locationId: c.locationId ?? null,
				postedAt: c.postedAt as string,
				classes: caroClasses(c.lines),
			}));
		return {
			from: query.from,
			to: query.to,
			locationId: query.locationId,
			counts,
			reportable: counts.reduce((sum, c) => sum + c.classes.filter((k) => k.reportable).length, 0),
		};
	}
}

@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/accounts/reports/caro-stock')
export class CaroStockController {
	constructor(private readonly caro: CaroStockService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'reportCaroStock', summary: 'Stock counts against CARO 3(ii)(a)’s 10% line' })
	report(@Query(new ZodValidationPipe(CaroStockQuery)) query: CaroStockQuery) {
		return this.caro.report(query);
	}
}
