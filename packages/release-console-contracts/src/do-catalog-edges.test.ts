import { describe, expect, it } from 'vitest';

import {
	type DoCatalog,
	draftProblems,
	dropletCost,
	dropletRequestOf,
	serverDraftOf,
	sizeFamily,
} from './do-catalog.js';

const size = (slug: string, diskGb: number) => ({
	slug,
	description: 'Basic',
	family: 'regular' as const,
	memoryMb: 4096,
	vcpus: 2,
	diskGb,
	transferTb: 4,
	priceMonthly: 24,
	priceHourly: 0.03571,
	regions: ['blr1'],
	available: true,
});

const catalog: DoCatalog = {
	regions: [{ slug: 'blr1', name: 'Bangalore 1', available: true, sizes: ['s-2vcpu-4gb'], features: [] }],
	sizes: [size('s-2vcpu-4gb', 80), size('s-1vcpu-512mb-10gb', 10)],
	images: [
		{
			id: 1,
			slug: 'ubuntu-26-04-x64',
			name: '26.04 (LTS) x64',
			distribution: 'Ubuntu',
			kind: 'os',
			regions: ['blr1'],
			minDiskGb: 25,
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

const draft = () => ({ ...serverDraftOf('saha-textile', 'staging'), sshKeyIds: [7] });

describe('DigitalOcean create steps at their edges', () => {
	it('groups storage-optimised sizes, and anything unknown as other', () => {
		expect(sizeFamily('so-2vcpu-16gb')).toBe('storage');
		expect(sizeFamily('zz-1vcpu-1gb')).toBe('other');
	});

	it('starts an environment it has no size for from staging’s size', () => {
		expect(serverDraftOf('saha-textile', 'preview').size).toBe('s-2vcpu-4gb');
	});

	it('asks for daily backups, a private network and a volume, and leaves the first-boot file out when off', () => {
		const body = dropletRequestOf({
			...draft(),
			backups: 'daily',
			backupHour: 4,
			vpcId: 'vpc-1',
			volumeGb: 50,
			firstBoot: false,
		});
		expect(body).toMatchObject({ backups: true, backup_policy: { plan: 'daily', hour: 4 }, vpc_uuid: 'vpc-1' });
		expect(body['volumes']).toHaveLength(1);
		expect(body).not.toHaveProperty('user_data');
		const off = dropletRequestOf({ ...draft(), backups: 'off' });
		expect(off).toMatchObject({ backups: false });
		expect(off).not.toHaveProperty('backup_policy');
	});

	it('prices a size it does not know as nothing', () => {
		expect(dropletCost(draft(), undefined)).toMatchObject({ droplet: 0, each: 0, hourly: 0 });
	});

	it('names a missing region, image and size, a disk too small, and one name per droplet', () => {
		expect(draftProblems({ ...draft(), region: 'xx9' }, catalog)).toContain('Region: choose a region.');
		expect(draftProblems({ ...draft(), image: 'debian-13' }, catalog)).toContain('Image: choose an image.');
		expect(draftProblems({ ...draft(), size: 's-64vcpu' }, catalog)).toContain('Size: choose a size.');
		expect(draftProblems({ ...draft(), size: 's-1vcpu-512mb-10gb' }, catalog)).toContain(
			'Size: the image needs at least 25 GB of disk; s-1vcpu-512mb-10gb has 10 GB.',
		);
		expect(draftProblems({ ...draft(), quantity: 2 }, catalog)).toContain('Name: one name per droplet.');
		expect(draftProblems({ ...draft(), image: 1 }, catalog)).toEqual([]);
	});

	it('passes on what the draft’s own shape refuses, with the field it is about', () => {
		const problems = draftProblems({ ...draft(), backupHour: 99 }, catalog);
		expect(problems.some((problem) => problem.startsWith('backupHour: '))).toBe(true);
	});
});
