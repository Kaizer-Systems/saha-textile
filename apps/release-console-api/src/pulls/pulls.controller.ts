import { Controller, Get, Param, Query } from '@nestjs/common';
import {
	type PullBasePreview,
	type PullCommitPage,
	type PullCommits,
	type PullDiff,
	type PullFiles,
	type PullLog,
	type PullPage,
	type PullRow,
	type VendorAnswer,
	commitIdSchema,
	pullBasePreviewQuerySchema,
	pullCommitsQuerySchema,
	pullDiffQuerySchema,
	pullListQuerySchema,
} from '@saha-textile/release-console-contracts';
import { z } from 'zod';

import { PullsService } from './pulls.service.js';
import { parseBody } from '../common/parse.js';

const number = z.coerce.number().int().positive().max(10_000_000);

/** Ship › Code › Pull requests: the list and each pull request's page (brief E5WE6RSF2AJvpxDyDA1EJt). */
@Controller('api/projects/:p/repos/:r/github/pulls')
export class PullsController {
	constructor(private readonly pulls: PullsService) {}

	@Get()
	list(@Param('p') p: string, @Param('r') r: string, @Query() q: unknown): Promise<VendorAnswer<PullRow[]>> {
		return this.pulls.list(p, r, parseBody(pullListQuerySchema, q).state);
	}

	@Get(':n')
	page(@Param('p') p: string, @Param('r') r: string, @Param('n') n: string): Promise<VendorAnswer<PullPage>> {
		return this.pulls.page(p, r, parseBody(number, n));
	}

	@Get(':n/commits')
	commits(
		@Param('p') p: string,
		@Param('r') r: string,
		@Param('n') n: string,
		@Query() q: unknown,
	): Promise<VendorAnswer<PullCommits>> {
		return this.pulls.commits(p, r, parseBody(number, n), parseBody(pullCommitsQuerySchema, q).page);
	}

	@Get(':n/commits/:sha')
	commit(
		@Param('p') p: string,
		@Param('r') r: string,
		@Param('n') n: string,
		@Param('sha') sha: string,
	): Promise<VendorAnswer<PullCommitPage>> {
		parseBody(number, n);
		return this.pulls.commit(p, r, parseBody(commitIdSchema, sha));
	}

	@Get(':n/files')
	files(@Param('p') p: string, @Param('r') r: string, @Param('n') n: string): Promise<VendorAnswer<PullFiles>> {
		return this.pulls.changedFiles(p, r, parseBody(number, n));
	}

	@Get(':n/checks/:job/log')
	log(
		@Param('p') p: string,
		@Param('r') r: string,
		@Param('n') n: string,
		@Param('job') job: string,
	): Promise<VendorAnswer<PullLog>> {
		parseBody(number, n);
		return this.pulls.log(p, r, parseBody(number, job));
	}

	@Get(':n/base-preview')
	basePreview(
		@Param('p') p: string,
		@Param('r') r: string,
		@Param('n') n: string,
		@Query() q: unknown,
	): Promise<VendorAnswer<PullBasePreview>> {
		return this.pulls.basePreview(p, r, parseBody(number, n), parseBody(pullBasePreviewQuerySchema, q).base);
	}

	@Get(':n/diff')
	diff(
		@Param('p') p: string,
		@Param('r') r: string,
		@Param('n') n: string,
		@Query() q: unknown,
	): Promise<VendorAnswer<PullDiff>> {
		return this.pulls.diff(p, r, parseBody(number, n), parseBody(pullDiffQuerySchema, q));
	}
}
