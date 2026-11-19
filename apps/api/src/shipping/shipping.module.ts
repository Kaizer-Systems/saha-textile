import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AdminShippingController } from './admin-shipping.controller';
import { ShippingAdminService } from './shipping-admin.service';
import { ShippingSnapshotService } from './shipping-snapshot.service';

/** Shipping rule sets, where they apply, and the zone settings (brief approved 2026-11-19). */
@Module({
	imports: [AuthModule, CatalogModule],
	controllers: [AdminShippingController],
	providers: [ShippingAdminService, ShippingSnapshotService],
	exports: [ShippingSnapshotService],
})
export class ShippingModule {}
