import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CouponsService } from './coupons.service';
import { OrderSettingsService } from './order-settings.service';
import { AdminCouponsController, AdminOrderSettingsController, AdminZonesController } from './orders-setup.controller';
import { ZonesService } from './zones.service';

/** Coupons, zones, order settings and document numbers (orders and checkout brief, approved 2026-11-20). */
@Module({
	imports: [AuthModule],
	controllers: [AdminCouponsController, AdminZonesController, AdminOrderSettingsController],
	providers: [CouponsService, ZonesService, OrderSettingsService],
	exports: [CouponsService, ZonesService, OrderSettingsService],
})
export class OrdersSetupModule {}
