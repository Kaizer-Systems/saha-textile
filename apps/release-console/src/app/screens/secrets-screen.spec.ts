import { tierOf } from './secrets-screen';

describe('Secrets screen', () => {
	it('reads each console environment’s own Infisical tier', () => {
		expect(tierOf('local', true)).toBe('local');
		expect(tierOf('development', false)).toBe('development');
		expect(tierOf('dev', false)).toBe('development');
		// A development environment run on this computer reads the local project.
		expect(tierOf('development', true)).toBe('local');
		expect(tierOf('staging', false)).toBe('staging');
		expect(tierOf('production', false)).toBe('production');
		expect(tierOf('preview', false)).toBeNull();
	});
});
