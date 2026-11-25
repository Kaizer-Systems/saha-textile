import { Controller, Get } from '@nestjs/common';
import { type ConsoleApiHealth } from '@saha-textile/release-console-contracts';

import { appBuild } from '../app-files/app-files.js';
import { Open } from '../lock/session.guard.js';

@Controller('api/health')
@Open()
export class HealthController {
	/** Worked out once, when the console starts: the app it serves and the moment it started. */
	private readonly build = appBuild(process.env['CONSOLE_APP_DIR']);
	private readonly startedAt = new Date().toISOString();

	@Get()
	health(): ConsoleApiHealth {
		return { status: 'ok', version: '0.2.0', build: this.build, startedAt: this.startedAt };
	}
}
