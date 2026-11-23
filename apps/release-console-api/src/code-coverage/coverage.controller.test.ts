import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { ProjectsService } from '../projects/projects.service.js';
import { VendorReadsService } from '../projects/vendor-reads.service.js';
import { CoverageController } from './coverage.controller.js';
import { CoverageService } from './coverage.service.js';

describe('the coverage routes', () => {
	const service = {
		list: vi.fn(async () => ({ ci: [], ciMessage: null, mac: null, macMessage: null })),
		tree: vi.fn(async () => ({ state: 'not-connected' as const, message: 'x' })),
		file: vi.fn(async () => ({ state: 'not-connected' as const, message: 'y' })),
	};
	const routes = new CoverageController(service);

	it('passes checked questions on to the service', async () => {
		expect(await routes.runs('p', 'r')).toEqual({ ci: [], ciMessage: null, mac: null, macMessage: null });
		await routes.tree('p', 'r', { source: 'ci', run: '7', base: 'feat/combined-after-pr6' });
		expect(service.tree).toHaveBeenCalledWith('p', 'r', 'ci', '7', 'feat/combined-after-pr6');
		await routes.file('p', 'r', { source: 'mac', run: 'mac', path: 'apps/admin/src/a.ts' });
		expect(service.file).toHaveBeenCalledWith('p', 'r', 'mac', 'mac', 'apps/admin/src/a.ts', undefined);
	});

	it('refuses a run, source, base or path it does not expect, before anything is read', () => {
		expect(() => routes.tree('p', 'r', { source: 'ci', run: '../x' })).toThrow(BadRequestException);
		expect(() => routes.tree('p', 'r', { source: 'gitlab', run: '7' })).toThrow(BadRequestException);
		expect(() => routes.tree('p', 'r', { source: 'ci', run: '7', base: 'a b' })).toThrow(BadRequestException);
		expect(() => routes.file('p', 'r', { source: 'ci', run: '7' })).toThrow(BadRequestException);
		expect(() => routes.file('p', 'r', { source: 'ci', run: '7', path: 'x'.repeat(501) })).toThrow(BadRequestException);
	});
});

describe('wiring', () => {
	it('lets Nest build the coverage routes from their injected parts', async () => {
		const projects = { repository: () => ({ project: {}, repo: { name: 'x', sourceCode: { repository: 'o/x' } } }) };
		const reads = { sourceCode: async () => ({ state: 'not-connected', message: 'No key.' }) };
		const module = await Test.createTestingModule({
			controllers: [CoverageController],
			providers: [CoverageService, { provide: VendorReadsService, useValue: reads }, { provide: ProjectsService, useValue: projects }],
		}).compile();
		const routes = module.get(CoverageController);
		module.get(CoverageService).helper = { call: async () => ({ off: true, message: 'Nothing yet.' }) } as never;
		expect(await routes.runs('p', 'r')).toEqual({ ci: [], ciMessage: 'No key.', mac: null, macMessage: 'Nothing yet.' });
	});
});
