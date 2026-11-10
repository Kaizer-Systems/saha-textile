import { Controller, Get } from '@nestjs/common';
import { type ConsoleApiHealth } from '@saha-textile/release-console-contracts';

import { Open } from '../lock/session.guard.js';

@Controller('api/health')
@Open()
export class HealthController {
	@Get()
	health(): ConsoleApiHealth {
		return { status: 'ok', version: '0.2.0' };
	}
}
