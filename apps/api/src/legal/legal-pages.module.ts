import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AdminLegalPagesController, PublicLegalPagesController } from './legal-pages.controller';
import { LegalPagesService } from './legal-pages.service';

/** The four legal pages (Legal Pages brief, approved 2026-11-15): written in Admin › Pages, read by the shop. */
@Module({
	imports: [AuthModule],
	controllers: [AdminLegalPagesController, PublicLegalPagesController],
	providers: [LegalPagesService],
})
export class LegalPagesModule {}
