import { Controller, Get } from '@nestjs/common';
import { type ConsoleApiHealth } from '@saha-textile/release-console-contracts';

@Controller('api/health')
export class HealthController {
	@Get()
	health(): ConsoleApiHealth {
		return { status: 'ok', version: '0.1.0' };
	}
}
