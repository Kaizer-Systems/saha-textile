import { describe, expect, it } from 'vitest';

import { type ResolvedPageSectionView, sectionClasses, sectionContainer } from './page-builder.types';

const section = (
	look: Partial<ResolvedPageSectionView['look']> = {},
	screens: Partial<ResolvedPageSectionView['screens']> = {},
) =>
	({
		look: { spaceAbove: 'none', spaceBelow: 'm', width: 'page', align: 'start', background: 'none', ...look },
		screens: { phone: true, tablet: true, computer: true, ...screens },
	}) as ResolvedPageSectionView;

describe('section look (SG-3)', () => {
	it('turns the fixed steps into named classes, and adds display classes only when a band is off', () => {
		expect(sectionClasses(section())).toBe('pt-0 pb-4');
		expect(sectionClasses(section({ spaceAbove: 'xl', spaceBelow: 'none' }))).toBe('pt-5 pb-0 mt-5');
		expect(sectionClasses(section({}, { phone: false }))).toBe('d-none d-md-block d-xl-block pt-0 pb-4');
		expect(sectionClasses(section({}, { computer: false }))).toBe('d-block d-md-block d-xl-none pt-0 pb-4');
	});

	it('picks the container for each width', () => {
		expect(sectionContainer(section({ width: 'page' }))).toBe('container-fluid-lg');
		expect(sectionContainer(section({ width: 'full' }))).toBe('container-fluid px-0');
		expect(sectionContainer(section({ width: 'narrow' }))).toBe('container');
	});
});
