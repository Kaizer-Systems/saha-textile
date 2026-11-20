import { describe, expect, it } from 'vitest';

import { clientBuild, clientBuildValue } from './client-build.interceptor';

describe('shop client build', () => {
	it('sends only a real build, with -app for the installed app', () => {
		expect(clientBuild('ea27a021')).toBe('ea27a021');
		expect(clientBuild('dev')).toBeNull();
		expect(clientBuild(undefined)).toBeNull();
		expect(clientBuild('EA27A021; x')).toBeNull();
		expect(clientBuildValue('ea27a021', false)).toBe('ea27a021');
		expect(clientBuildValue('ea27a021', true)).toBe('ea27a021-app');
	});
});
