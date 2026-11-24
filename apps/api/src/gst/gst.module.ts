import { Module } from '@nestjs/common';

import { AccountsTemplatesModule } from '../accounts-templates/accounts-templates.module';

import { GstReturnsController } from './gst-returns.controller';
import { GstReturnsService } from './gst-returns.service';

/** GST returns from the books (accounts brief G). */
@Module({
	imports: [AccountsTemplatesModule],
	controllers: [GstReturnsController],
	providers: [GstReturnsService],
})
export class GstModule {}
