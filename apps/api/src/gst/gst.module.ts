import { Module } from '@nestjs/common';

import { AccountsTemplatesModule } from '../accounts-templates/accounts-templates.module';

import { GstReturnsController } from './gst-returns.controller';
import { GstReturnsService } from './gst-returns.service';
import { Gstr2bController } from './gstr2b.controller';
import { Gstr2bService } from './gstr2b.service';
import { Gstr3bInputs } from './gstr3b-inputs';

/** GST returns from the books and GSTR-2B against our purchases (accounts brief G). */
@Module({
	imports: [AccountsTemplatesModule],
	controllers: [GstReturnsController, Gstr2bController],
	providers: [GstReturnsService, Gstr2bService, Gstr3bInputs],
	exports: [GstReturnsService],
})
export class GstModule {}
