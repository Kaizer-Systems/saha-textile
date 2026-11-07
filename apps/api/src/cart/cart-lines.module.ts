import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module';
import { CartLinesService } from './cart-lines.service';
import { CartController } from './cart.controller';
import { CartModule } from './cart.module';

/** Separate from `CartModule`, which auth needs for the guest merge, so catalogue → auth → cart stays a line. */
@Module({
	imports: [CartModule, CatalogModule],
	controllers: [CartController],
	providers: [CartLinesService],
})
export class CartLinesModule {}
