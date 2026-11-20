import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BusinessesService } from './businesses.service';
import { CouponsService } from './coupons.service';
import { DocumentNumbersService } from './document-numbers.service';
import { OrderSettingsService } from './order-settings.service';
import {
	AdminBusinessesController,
	AdminCouponsController,
	AdminOrderSettingsController,
	AdminZonesController,
} from './orders-setup.controller';
import { ZonesService } from './zones.service';

/** Coupons, zones, order settings and document numbers (orders and checkout brief, approved 2026-11-20). */
@Module({
	imports: [AuthModule],
	controllers: [
		AdminCouponsController,
		AdminZonesController,
		AdminOrderSettingsController,
		AdminBusinessesController,
	],
	providers: [CouponsService, ZonesService, OrderSettingsService, DocumentNumbersService, BusinessesService],
	exports: [CouponsService, ZonesService, OrderSettingsService, DocumentNumbersService, BusinessesService],
})
export class OrdersSetupModule {}
