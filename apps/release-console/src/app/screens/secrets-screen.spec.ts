import { tierOf } from './secrets-screen';

describe('Secrets screen', () => {
	it('reads each console environment’s own Infisical tier', () => {
		expect(tierOf('local', true)).toBe('dev');
		expect(tierOf('staging', false)).toBe('staging');
		expect(tierOf('production', false)).toBe('production');
		expect(tierOf('preview', false)).toBeNull();
	});
});
