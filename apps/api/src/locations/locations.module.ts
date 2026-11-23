import { Module } from '@nestjs/common';

import { LocationsController, MyLocationController } from './locations.controller';
import { LocationsService } from './locations.service';

/** Locations and who works where (accounts brief K, L). */
@Module({
	controllers: [LocationsController, MyLocationController],
	providers: [LocationsService],
	exports: [LocationsService],
})
export class LocationsModule {}
