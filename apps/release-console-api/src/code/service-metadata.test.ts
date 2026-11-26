import { describe, expect, it, vi } from 'vitest';

/** As ../controller-metadata.test.ts: the Code reads with what they are given missing. */
vi.mock('../projects/vendor-reads.service.js', async (load) => ({
	...(await load<object>()),
	VendorReadsService: undefined,
}));
vi.mock('../pulls/repo-copy.js', async (load) => ({ ...(await load<object>()), RepoCopy: undefined }));
vi.mock('../store/console-store.js', async (load) => ({ ...(await load<object>()), ConsoleStore: undefined }));

describe('the Code reads without what they are given', () => {
	it('declare Object for each missing type', async () => {
		const { CodeService } = await import('./code.service.js');
		expect(Reflect.getMetadata('design:paramtypes', CodeService)).toEqual([Object, Object, Object]);
	});
});
