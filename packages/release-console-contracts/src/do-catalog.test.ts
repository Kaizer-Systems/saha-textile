import { describe, expect, it } from 'vitest';

import {
	FIRST_BOOT_MARK,
	type DoCatalog,
	draftProblems,
	dropletCost,
	dropletRequestOf,
	namesFor,
	serverDraftOf,
	sizeFamily,
} from './do-catalog.js';

const catalog: DoCatalog = {
	regions: [
		{ slug: 'blr1', name: 'Bangalore 1', available: true, sizes: ['s-2vcpu-4gb'], features: ['metadata'] },
		{ slug: 'nyc1', name: 'New York 1', available: false, sizes: [], features: [] },
	],
	sizes: [
		{
			slug: 's-2vcpu-4gb',
			description: 'Basic',
			family: 'regular',
			memoryMb: 4096,
			vcpus: 2,
			diskGb: 80,
			transferTb: 4,
			priceMonthly: 24,
			priceHourly: 0.03571,
			regions: ['blr1'],
			available: true,
		},
	],
	images: [
		{
			id: 1,
			slug: 'ubuntu-26-04-x64',
			name: '26.04 (LTS) x64',
			distribution: 'Ubuntu',
			kind: 'os',
			regions: ['blr1'],
			minDiskGb: 7,
			sizeGb: null,
			createdAt: '2026-04-30T00:00:00Z',
			of: null,
		},
	],
	sshKeys: [{ id: 7, name: 'example key', fingerprint: 'aa:bb' }],
	vpcs: [],
	projects: [],
	missing: [],
};

describe('DigitalOcean create steps', () => {
	it('groups sizes the way DigitalOcean does', () => {
		expect(sizeFamily('s-2vcpu-4gb')).toBe('regular');
		expect(sizeFamily('s-2vcpu-4gb-amd')).toBe('amd');
		expect(sizeFamily('s-2vcpu-4gb-intel')).toBe('intel');
		expect(sizeFamily('g-2vcpu-8gb')).toBe('general');
		expect(sizeFamily('gd-2vcpu-8gb')).toBe('general');
		expect(sizeFamily('c2-2vcpu-4gb')).toBe('cpu');
		expect(sizeFamily('m3-2vcpu-16gb')).toBe('memory');
		expect(sizeFamily('so1_5-2vcpu-16gb')).toBe('storage');
		expect(sizeFamily('gpu-h100x1-80gb')).toBe('gpu');
		expect(sizeFamily('s5-2vcpu-4gb-80gb')).toBe('v5shared');
		expect(sizeFamily('g5-2vcpu-8gb-50gb')).toBe('v5general');
	});

	it('starts from the agreed server for the environment, named after the project', () => {
		const d = serverDraftOf('saha-textile', 'staging');
		expect(d).toMatchObject({ region: 'blr1', image: 'ubuntu-26-04-x64', size: 's-2vcpu-4gb', firstBoot: true });
		expect(d.names).toEqual(['saha-textile-staging']);
		expect(d.tags).toEqual(['saha-textile', 'saha-textile-staging']);
		expect(serverDraftOf('saha-textile', 'production').size).toBe('s-4vcpu-8gb');
	});

	it('builds the exact request, with the first-boot file only as a mark', () => {
		const d = { ...serverDraftOf('saha-textile', 'staging'), sshKeyIds: [7], backups: 'weekly' as const };
		const body = dropletRequestOf(d);
		expect(body).toMatchObject({
			name: 'saha-textile-staging',
			region: 'blr1',
			size: 's-2vcpu-4gb',
			ssh_keys: [7],
			backups: true,
			backup_policy: { plan: 'weekly', weekday: 'SUN', hour: 20 },
			user_data: FIRST_BOOT_MARK,
		});
		expect(body).not.toHaveProperty('names');
		expect(dropletRequestOf({ ...d, quantity: 2, names: namesFor('web', 2) })).toMatchObject({
			names: ['web', 'web-2'],
		});
	});

	it('prices the droplet, its backups and a volume', () => {
		const d = { ...serverDraftOf('saha-textile', 'staging'), backups: 'weekly' as const, volumeGb: 100 };
		const cost = dropletCost(d, catalog.sizes[0]);
		expect(cost.droplet).toBe(24);
		expect(cost.backups).toBeCloseTo(4.8);
		expect(cost.volume).toBe(10);
		expect(cost.total).toBeCloseTo(38.8);
	});

	it('names what stops the create, step by step', () => {
		const d = serverDraftOf('saha-textile', 'staging');
		expect(draftProblems(d, catalog)).toEqual(['Sign-in: pick at least one SSH key.']);
		expect(draftProblems({ ...d, sshKeyIds: [7], region: 'nyc1' }, catalog)).toEqual([
			'Region: New York 1 takes no new droplets right now.',
			'Image: Ubuntu 26.04 (LTS) x64 is not in New York 1.',
			'Size: s-2vcpu-4gb is not offered in New York 1.',
		]);
	});
});
