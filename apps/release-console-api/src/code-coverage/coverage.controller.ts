import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import {
	type CoverageFileAnswer,
	type CoverageRuns,
	type CoverageTreeAnswer,
	type VendorAnswer,
	coverageSourceSchema,
} from '@saha-textile/release-console-contracts';
import { z } from 'zod';

import { parseBody } from '../common/parse.js';
import { CoverageService } from './coverage.service.js';

/** A run id (digits on CI, `mac` for this Mac) and a change base ('commit' or a branch name). */
const runQuery = z.object({
	source: coverageSourceSchema,
	run: z.string().regex(/^(\d{1,20}|mac)$/),
	base: z
		.string()
		.regex(/^[\w./-]{1,120}$/)
		.optional(),
});
const fileQuery = runQuery.extend({ path: z.string().min(1).max(500) });

/**
 * Ship › Code › Coverage (brief CRmpBdP3ce62g1JoCAhh23, approved 24 Nov 2026). Reads only: CI runs through
 * the repository's GitHub key, this Mac through the helper.
 */
@Controller('api/projects/:p/repos/:r/coverage')
export class CoverageController {
	constructor(@Inject(CoverageService) private readonly coverage: Pick<CoverageService, 'list' | 'tree' | 'file'>) {}

	@Get('runs')
	runs(@Param('p') p: string, @Param('r') r: string): Promise<CoverageRuns> {
		return this.coverage.list(p, r);
	}

	@Get('tree')
	tree(
		@Param('p') p: string,
		@Param('r') r: string,
		@Query() query: unknown,
	): Promise<VendorAnswer<CoverageTreeAnswer>> {
		const q = parseBody(runQuery, query);
		return this.coverage.tree(p, r, q.source, q.run, q.base);
	}

	@Get('file')
	file(
		@Param('p') p: string,
		@Param('r') r: string,
		@Query() query: unknown,
	): Promise<VendorAnswer<CoverageFileAnswer>> {
		const q = parseBody(fileQuery, query);
		return this.coverage.file(p, r, q.source, q.run, q.path, q.base);
	}
}
