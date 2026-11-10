import { Controller, Get } from '@nestjs/common';
import { type Readiness, type ServicesSnapshot } from '@saha-textile/release-console-contracts';

import { LocalStackService } from './local-stack.service.js';

@Controller('api/local')
export class LocalStackController {
	constructor(private readonly stack: LocalStackService) {}

	@Get('services')
	services(): Promise<ServicesSnapshot> {
		return this.stack.services();
	}

	@Get('readiness')
	readiness(): Promise<Readiness> {
		return this.stack.readiness();
	}
}
