import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import {
	type ProductJob,
	type ProductTab,
	type VendorAnswer,
	productWriteSchema,
} from '@saha-textile/release-console-contracts';

import { ProductsService } from './products.service.js';
import { parseBody } from '../common/parse.js';
import { LockService } from '../lock/lock.service.js';
import { sessionOf } from '../lock/session.guard.js';

type Req = Parameters<typeof sessionOf>[0];

/**
 * The DigitalOcean and Cloudflare product screens (brief v7 lifecycle): each tab's live read, each
 * form, sending a form after the PIN, and the changes being followed.
 */
@Controller('api')
export class ProductsController {
	constructor(
		private readonly products: ProductsService,
		private readonly lock: LockService,
	) {}

	@Get('product-screens')
	catalogue(): ReturnType<ProductsService['catalogue']> {
		return this.products.catalogue();
	}

	@Get('projects/:p/repos/:r/products/:screen/tab/:tab')
	tab(
		@Param('p') p: string,
		@Param('r') r: string,
		@Param('screen') screen: string,
		@Param('tab') tab: string,
		@Query('id') id?: string,
		@Query('range') range?: string,
	): Promise<VendorAnswer<ProductTab>> {
		return this.products.tab(p, r, screen, tab, id || null, range);
	}

	@Get('projects/:p/repos/:r/products/:screen/form/:form')
	form(
		@Param('p') p: string,
		@Param('r') r: string,
		@Param('screen') screen: string,
		@Param('form') form: string,
		@Query('id') id?: string,
	): Promise<VendorAnswer<ProductTab>> {
		return this.products.form(p, r, screen, form, id || null);
	}

	@Post('projects/:p/repos/:r/products/:screen/form/:form')
	@HttpCode(202)
	send(
		@Param('p') p: string,
		@Param('r') r: string,
		@Param('screen') screen: string,
		@Param('form') form: string,
		@Body() body: unknown,
		@Req() req: Req,
	): Promise<ProductJob> {
		const input = parseBody(productWriteSchema, body);
		this.lock.confirm(sessionOf(req), input.pin, `${form} on ${screen}`);
		return this.products.send(p, r, screen, form, input);
	}

	@Get('projects/:p/repos/:r/products/:screen/jobs')
	jobs(@Param('p') p: string, @Param('r') r: string, @Param('screen') screen: string): ProductJob[] {
		return this.products.list(p, r, screen);
	}
}
