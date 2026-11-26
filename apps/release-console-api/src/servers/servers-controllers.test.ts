import { describe, expect, it, vi } from 'vitest';

import { EnvTagsController, ServersController, SshListController } from './servers.controller.js';

import type { DropletJobs } from './droplet-jobs.js';
import type { LockService } from '../lock/lock.service.js';
import type { ProjectsService } from '../projects/projects.service.js';

/** The PIN check and the session are stand-ins: these tests are about what each route asks for. */
const lock = { confirm: vi.fn() } as unknown as LockService & { confirm: ReturnType<typeof vi.fn> };
const req = { headers: { authorization: 'Bearer session-1' } } as never;

describe('the server routes', () => {
	it('confirms the PIN with words for Finish setup and for Renew token', async () => {
		const jobs = { startFix: vi.fn(async () => ({ id: 'job' })) } as unknown as DropletJobs;
		const c = new ServersController(jobs, lock);
		const words = () => (lock.confirm.mock.calls.at(-1) as unknown[])[2];
		await c.fix('acme', 'shop', 'do1', { pin: '123456', environment: 'staging', kind: 'finish' }, req);
		expect(words()).toBe('finish setting up staging');
		await c.fix('acme', 'shop', 'do1', { pin: '123456', environment: 'staging', kind: 'renew' }, req);
		expect(words()).toBe('renew the deploy token of staging');
	});

	it('saves the SSH list after the PIN and answers which hosts followed', async () => {
		const jobs = { updateSshList: vi.fn(async () => ['ssh-staging.example.com']) } as unknown as DropletJobs;
		const projects = {
			setSshEmails: vi.fn(() => ({ sshEmails: ['owner@example.com'] })),
		} as unknown as ProjectsService;
		const c = new SshListController(jobs, lock, projects);
		expect(await c.set('acme', { pin: '123456', emails: ['owner@example.com'] }, req)).toEqual({
			emails: ['owner@example.com'],
			hosts: ['ssh-staging.example.com'],
		});
	});

	it('reads and sets a resource’s environment tag', () => {
		const projects = {
			envTags: vi.fn(() => ({ 'do:droplet:1': 'staging' })),
			setEnvTag: vi.fn(() => ({})),
		} as unknown as ProjectsService;
		const c = new EnvTagsController(lock, projects);
		expect(c.list('acme', 'shop')).toEqual({ 'do:droplet:1': 'staging' });
		c.set('acme', 'shop', { pin: '123456', key: 'do:droplet:1', env: null }, req);
		expect(projects.setEnvTag).toHaveBeenCalledWith('acme', 'shop', 'do:droplet:1', null);
	});
});
