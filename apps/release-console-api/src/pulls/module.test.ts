import { describe, expect, it } from 'vitest';

import { RepoCopy } from './repo-copy.js';
import { AppModule } from '../app.module.js';

describe('the console API module', () => {
	it('builds one copy keeper for repositories, in the console’s data folder', () => {
		const providers = Reflect.getMetadata('providers', AppModule) as Array<{
			provide?: unknown;
			useFactory?: () => unknown;
		}>;
		const made = providers.find((p) => p.provide === RepoCopy)?.useFactory?.();
		expect(made).toBeInstanceOf(RepoCopy);
		expect((made as RepoCopy).folder('o/r')).toMatch(/repositories[/\\]o__r\.git$/);
	});
});
