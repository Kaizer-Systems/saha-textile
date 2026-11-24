import { Module } from '@nestjs/common';

import { GstAnnualController } from './gst-annual.controller';
import { GstAnnualService } from './gst-annual.service';
import { GstModule } from './gst.module';

/** GST reports beyond the monthly returns: GSTR-9 and the books-to-returns check (accounts brief G7, G9). */
@Module({
	imports: [GstModule],
	controllers: [GstAnnualController],
	providers: [GstAnnualService],
})
export class GstReportsModule {}
