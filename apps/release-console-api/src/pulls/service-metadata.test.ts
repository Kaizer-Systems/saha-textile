import { describe, expect, it, vi } from 'vitest';

/** As ../controller-metadata.test.ts: the pull request reads with what they are given missing. */
vi.mock('../projects/vendor-reads.service.js', async (load) => ({
	...(await load<object>()),
	VendorReadsService: undefined,
}));
vi.mock('./repo-copy.js', async (load) => ({ ...(await load<object>()), RepoCopy: undefined }));

describe('the pull request reads without what they are given', () => {
	it('declare Object for each missing type', async () => {
		const { PullsService } = await import('./pulls.service.js');
		expect(Reflect.getMetadata('design:paramtypes', PullsService)).toEqual([Object, Object]);
	});
});
