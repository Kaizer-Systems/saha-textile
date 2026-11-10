import { Module } from '@nestjs/common';

import { HealthController } from './health/health.controller.js';
import { LocalStackController } from './local-stack/local-stack.controller.js';
import { LocalStackService } from './local-stack/local-stack.service.js';

@Module({
	controllers: [HealthController, LocalStackController],
	providers: [LocalStackService],
})
export class AppModule {}
