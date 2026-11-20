import { Controller, Get, Header, Inject, NotFoundException, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { GeoCountry, GeoCountryDetail, PinLookup } from '@saha-textile/contracts';
import type { GeoDataPort } from '@saha-textile/core-domain';

import { Public } from '../auth/session.guard';
import { GEO_DATA_PORT } from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';

/**
 * Country, State and phone data for every address form (shop account, admin customer page, both
 * checkouts; owner decision `DEC-ADDRESS`). Public and cacheable: it is reference data from the
 * repository's own file, the same for everyone, and holds nothing personal.
 */
@ApiTags(API_TAGS.orders)
@Controller('geo')
export class GeoController {
	constructor(@Inject(GEO_DATA_PORT) private readonly geo: GeoDataPort) {}

	@Get('countries')
	@Public()
	@Header('Cache-Control', 'public, max-age=86400')
	@ApiOperation({ operationId: 'listGeoCountries', summary: 'Countries with phone codes and address labels' })
	countries(): Promise<GeoCountry[]> {
		return this.geo.countries();
	}

	@Get('countries/:code')
	@Public()
	@Header('Cache-Control', 'public, max-age=86400')
	@ApiOperation({ operationId: 'getGeoCountry', summary: 'One country with its States or regions' })
	async country(@Param('code') code: string): Promise<GeoCountryDetail> {
		const country = await this.geo.country(code);
		if (!country) throw new NotFoundException('Unknown country');
		return country;
	}

	@Get('pin/:pin')
	@Public()
	@Header('Cache-Control', 'public, max-age=86400')
	@ApiOperation({
		operationId: 'lookupPin',
		summary: 'What an Indian PIN code tells an address form (null until the PIN directory is loaded)',
	})
	pin(@Param('pin') pin: string): Promise<PinLookup | null> {
		return this.geo.pin(pin);
	}
}
