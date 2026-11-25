import { describe, expect, it, vi } from 'vitest';

/** As ../controller-metadata.test.ts: the Code routes with what they are given missing, as a module cycle would leave them. */
vi.mock('./code.service.js', async (load) => ({ ...(await load<object>()), CodeService: undefined }));
vi.mock('../lock/lock.service.js', async (load) => ({ ...(await load<object>()), LockService: undefined }));

describe('the Code routes without what they are given', () => {
	it('declare Object for each missing type', async () => {
		const { CodeController } = await import('./code.controller.js');
		expect(Reflect.getMetadata('design:paramtypes', CodeController)).toEqual([Object, Object]);
	});
});
