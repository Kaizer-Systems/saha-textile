import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module';
import { WishlistController } from './wishlist.controller';
import { WishlistService } from './wishlist.service';

/** The signed-in customer's wishlist (owner decision 2026-11-08). */
@Module({
	imports: [CatalogModule],
	controllers: [WishlistController],
	providers: [WishlistService],
})
export class WishlistModule {}
