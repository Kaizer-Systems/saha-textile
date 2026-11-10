import { Controller, Get, Query } from '@nestjs/common';
import { type Readiness, type ServicesSnapshot } from '@saha-textile/release-console-contracts';
import { z } from 'zod';

import { LocalStackService } from './local-stack.service.js';
import { parseBody } from '../common/parse.js';

/** The repository whose containers to show: its id is the containers' name prefix. */
const repoQuery = z.object({
	repo: z
		.string()
		.regex(/^[a-z0-9][a-z0-9-]*$/)
		.max(60)
		.optional(),
});

@Controller('api/local')
export class LocalStackController {
	constructor(private readonly stack: LocalStackService) {}

	@Get('services')
	services(@Query() query: unknown): Promise<ServicesSnapshot> {
		return this.stack.services(parseBody(repoQuery, query).repo);
	}

	@Get('readiness')
	readiness(@Query() query: unknown): Promise<Readiness> {
		return this.stack.readiness(parseBody(repoQuery, query).repo);
	}
}
