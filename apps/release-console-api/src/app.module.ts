import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { HealthController } from './health/health.controller.js';
import { KeySourceService } from './keys/key-source.js';
import { LocalStackController } from './local-stack/local-stack.controller.js';
import { LocalStackService } from './local-stack/local-stack.service.js';
import { LockController } from './lock/lock.controller.js';
import { LockService } from './lock/lock.service.js';
import { SessionGuard } from './lock/session.guard.js';
import { AttentionService } from './projects/attention.service.js';
import { ProjectsController } from './projects/projects.controller.js';
import { ProjectsService } from './projects/projects.service.js';
import { VendorReadsService } from './projects/vendor-reads.service.js';
import { ConsoleStore } from './store/console-store.js';

@Module({
	controllers: [HealthController, LockController, LocalStackController, ProjectsController],
	providers: [
		ConsoleStore,
		LockService,
		LocalStackService,
		ProjectsService,
		VendorReadsService,
		AttentionService,
		KeySourceService,
		{ provide: APP_GUARD, useClass: SessionGuard },
	],
})
export class AppModule {}
