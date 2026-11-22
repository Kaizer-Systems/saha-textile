import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { PurchaseOrderDocument } from '../purchasing/purchase-order-document';
import { DocumentFormatsController } from './document-formats.controller';
import { DocumentFormatsService } from './document-formats.service';
import { OrderDocumentsController } from './order-documents.controller';

/** Document formats and their renderer (bundle builder brief F); other modules print through DocumentFormatsService. */
@Module({
	imports: [AuthModule, MediaModule],
	controllers: [DocumentFormatsController, OrderDocumentsController],
	providers: [DocumentFormatsService, PurchaseOrderDocument],
	exports: [DocumentFormatsService],
})
export class DocumentsModule {}
