import { Module } from '@nestjs/common';
import { FileGeoDataAdapter } from '@saha-textile/adapters-geo';

import { GEO_DATA_PORT } from '../infra/tokens';
import { GeoController } from './geo.controller';

/** Country, State and phone data (`DEC-ADDRESS`), from the repository's data file. */
@Module({
	controllers: [GeoController],
	providers: [{ provide: GEO_DATA_PORT, useFactory: () => new FileGeoDataAdapter() }],
	exports: [GEO_DATA_PORT],
})
export class GeoModule {}
