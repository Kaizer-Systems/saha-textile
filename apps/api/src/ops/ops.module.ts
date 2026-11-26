import { Module } from '@nestjs/common';

import { OpsTokenGuard } from './ops-token.guard';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';

/** The read-only operations address (`/ops`) for the Release Console. */
@Module({
	controllers: [OpsController],
	providers: [OpsService, OpsTokenGuard],
})
export class OpsModule {}
