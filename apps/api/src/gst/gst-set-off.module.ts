import { Module } from '@nestjs/common';

import { LedgerModule } from '../ledger/ledger.module';

import { GstSetOffController } from './gst-set-off.controller';
import { GstSetOffService } from './gst-set-off.service';
import { GstModule } from './gst.module';

/** Q7 Post the set-off: GSTR-3B's journal and challan payment, through the general ledger (accounts brief G6, Q7). */
@Module({
	imports: [GstModule, LedgerModule],
	controllers: [GstSetOffController],
	providers: [GstSetOffService],
})
export class GstSetOffModule {}
