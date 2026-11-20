import { describe, expect, it } from 'vitest';

import {
	dropletsAnswerSchema,
	newProjectSchema,
	projectNameSchema,
	repositoryFileSchema,
	linkKeySchema,
	vendorScreens,
} from './projects.js';

const repository = {
	id: 'shop-web',
	name: 'shop-web',
	sourceCode: { vendor: 'github', repository: 'example-org/shop-web' },
	environments: [{ name: 'local', label: 'Local' }],
};

describe('projects contracts', () => {
	it('fills defaults for a new project', () => {
		const p = newProjectSchema.parse({
			id: 'client-shop',
			name: 'Client shop',
			workspace: 'Clients',
			repositories: [repository],
		});
		expect(p.repositories[0]?.cloud).toEqual([]);
		expect(p.repositories[0]?.sourceCode.keyId).toBeNull();
		expect(p.repositories[0]?.environments[0]?.cloudId).toBeNull();
	});

	it('refuses a repository without owner/name or a project without repositories', () => {
		expect(() =>
			newProjectSchema.parse({
				id: 'x',
				name: 'X',
				workspace: 'W',
				repositories: [{ ...repository, sourceCode: { vendor: 'github', repository: 'no-slash' } }],
			}),
		).toThrow();
		expect(() => newProjectSchema.parse({ id: 'x', name: 'X', workspace: 'W', repositories: [] })).toThrow();
	});

	it('links a key by its Infisical names, never a value', () => {
		const ok = { id: 'do-read', kind: 'do-read', label: 'DigitalOcean API · read' };
		expect(linkKeySchema.parse({ ...ok, envNames: ['CONSOLE_DO_READ_TOKEN'] }).envNames).toEqual(['CONSOLE_DO_READ_TOKEN']);
		expect('value' in linkKeySchema.parse({ ...ok, value: 'never-kept' })).toBe(false);
		for (const name of ['lower_case', '1STARTS_WITH_DIGIT', 'HAS-DASH', 'HAS SPACE'])
			expect(() => linkKeySchema.parse({ ...ok, envNames: [name] })).toThrow();
		expect(() => linkKeySchema.parse({ ...ok, envNames: ['A1', 'B2', 'C3'] })).toThrow();
	});

	it('keeps project names plain', () => {
		expect(projectNameSchema.parse('Saha Textile')).toBe('Saha Textile');
		expect(() => projectNameSchema.parse('Shop "one"')).toThrow();
	});

	it('answers a vendor read in one of three ways', () => {
		expect(dropletsAnswerSchema.parse({ state: 'not-connected', message: 'Add a key' }).state).toBe(
			'not-connected',
		);
		expect(() => dropletsAnswerSchema.parse({ state: 'ok', readAt: 'yesterday', data: [] })).toThrow();
	});

	it('marks vendors without screens as screens later', () => {
		expect(vendorScreens('github')).toBe('full');
		expect(vendorScreens('gitlab')).toBe('later');
	});

	it('reads a repository file as its own menus only, never a project', () => {
		expect(repositoryFileSchema.parse({ menus: ['payments'], project: { id: 'x' } })).toEqual({
			menus: ['payments'],
		});
		expect(repositoryFileSchema.parse({})).toEqual({ menus: [] });
	});
});
