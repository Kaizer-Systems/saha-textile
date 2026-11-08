import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AdminStoreLocationsController } from './admin-store-locations.controller';
import { StoreLocationsAdminService } from './store-locations-admin.service';
import { StoreLocationsPublicController } from './store-locations-public.controller';
import { StoreLocationsPublicService } from './store-locations-public.service';

/** The shop's physical stores (owner log § stores, 2026-11-08): Contact Us cards and Settings › Stores. */
@Module({
	imports: [AuthModule],
	controllers: [StoreLocationsPublicController, AdminStoreLocationsController],
	providers: [StoreLocationsPublicService, StoreLocationsAdminService],
})
export class StoreLocationsModule {}
