import { Module } from '@nestjs/common';

import { GstReturnsController } from './gst-returns.controller';
import { GstReturnsService } from './gst-returns.service';

/** GST returns from the books (accounts brief G). */
@Module({
	controllers: [GstReturnsController],
	providers: [GstReturnsService],
})
export class GstModule {}
