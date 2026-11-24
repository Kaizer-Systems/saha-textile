import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { AppFilesController } from './app-files/app-files.controller.js';
import { CoverageController } from './code-coverage/coverage.controller.js';
import { CoverageService } from './code-coverage/coverage.service.js';
import { HealthController } from './health/health.controller.js';
import { KeySourceService } from './keys/key-source.js';
import { LocalStackController } from './local-stack/local-stack.controller.js';
import { LocalAlerts } from './local/local-alerts.js';
import { RequestLog } from './local/request-log.js';
import { LocalController } from './local/local.controller.js';
import { StatsCollector } from './local/stats-collector.js';
import { LocalStackService } from './local-stack/local-stack.service.js';
import { LockController } from './lock/lock.controller.js';
import { LockService } from './lock/lock.service.js';
import { SessionGuard } from './lock/session.guard.js';
import { AttentionService } from './projects/attention.service.js';
import { ProjectsController } from './projects/projects.controller.js';
import { ProjectsService } from './projects/projects.service.js';
import { ServerDeployController } from './projects/server-deploy.controller.js';
import { VendorReadsService } from './projects/vendor-reads.service.js';
import { HelperErrorFilter } from './runner/helper-error.filter.js';
import { RunnerClient } from './runner/runner-client.js';
import { DropletJobs } from './servers/droplet-jobs.js';
import { EnvTagsController, ServersController, SshListController } from './servers/servers.controller.js';
import { RotationController } from './projects/rotation.controller.js';
import { LocalDbReportController, ServerStateController } from './servers/server-state.controller.js';
import { TracesController, TracingController } from './local/traces.controller.js';
import { ConsoleStore } from './store/console-store.js';
import { ProductsController } from './products/products.controller.js';
import { ProductsService } from './products/products.service.js';
import { PullsController } from './pulls/pulls.controller.js';
import { PullsService } from './pulls/pulls.service.js';
import { RepoCopy } from './pulls/repo-copy.js';

@Module({
	controllers: [
		CoverageController,
		ProductsController,
		HealthController,
		LockController,
		LocalStackController,
		ProjectsController,
		PullsController,
		ServerDeployController,
		ServersController,
		SshListController,
		EnvTagsController,
		RotationController,
		ServerStateController,
		LocalDbReportController,
		TracesController,
		TracingController,
		LocalController,
		AppFilesController,
	],
	providers: [
		CoverageService,
		ConsoleStore,
		ProductsService,
		LockService,
		LocalStackService,
		ProjectsService,
		VendorReadsService,
		PullsService,
		// The console API's own copies of repositories, in its data folder (pull request page, Q2).
		{ provide: RepoCopy, useFactory: () => new RepoCopy() },
		AttentionService,
		KeySourceService,
		RunnerClient,
		StatsCollector,
		LocalAlerts,
		RequestLog,
		DropletJobs,
		{ provide: APP_FILTER, useClass: HelperErrorFilter },
		{ provide: APP_GUARD, useClass: SessionGuard },
	],
})
export class AppModule {}
