import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module';
import { PrivacyController } from './privacy.controller';

@Module({
	imports: [CatalogModule],
	controllers: [PrivacyController],
})
export class PrivacyModule {}
