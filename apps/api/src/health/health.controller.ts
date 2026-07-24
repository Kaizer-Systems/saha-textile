import { Controller, Get } from '@nestjs/common';

interface HealthStatus {
	status: 'ok';
	service: string;
	timestamp: string;
}

@Controller('health')
export class HealthController {
	@Get()
	check(): HealthStatus {
		return {
			status: 'ok',
			service: 'saha-textile-api',
			timestamp: new Date().toISOString(),
		};
	}
}
