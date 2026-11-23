import { Module } from '@nestjs/common';

import { GeoModule } from '../geo/geo.module';
import { LocationsController, MyLocationController } from './locations.controller';
import { LocationsService } from './locations.service';

/** Locations and who works where (accounts brief K, L). */
@Module({
	imports: [GeoModule],
	controllers: [LocationsController, MyLocationController],
	providers: [LocationsService],
	exports: [LocationsService],
})
export class LocationsModule {}
