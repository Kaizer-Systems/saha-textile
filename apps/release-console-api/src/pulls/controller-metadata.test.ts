import { describe, expect, it, vi } from 'vitest';

/** As ../controller-metadata.test.ts: the pull request routes with their service missing, as a module cycle would leave it. */
vi.mock('./pulls.service.js', async (load) => ({ ...(await load<object>()), PullsService: undefined }));

describe('the pull request routes without their service', () => {
	it('declare Object for the missing type', async () => {
		const { PullsController } = await import('./pulls.controller.js');
		expect(Reflect.getMetadata('design:paramtypes', PullsController)).toEqual([Object]);
	});
});
