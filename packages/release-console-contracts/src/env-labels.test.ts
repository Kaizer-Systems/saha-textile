import { describe, expect, it } from 'vitest';

import { envOfBranch, envOfDroplets, envOfHost, envOfHosts, envOfText, hostsIn } from './env-labels.js';

const envs = [
	{ name: 'local', label: 'Local', domains: ['localhost'], branch: 'main' },
	{ name: 'staging', label: 'Staging', domains: ['staging.example.com'], branch: 'staging' },
	{ name: 'production', label: 'Production', domains: ['example.com', 'www.example.com'], branch: 'main' },
];

describe('environment labels from what the console knows', () => {
	it('follows hosts: exact, SSH host, then the longest domain', () => {
		expect(envOfHost(envs, 'staging.example.com')).toBe('Staging');
		expect(envOfHost(envs, 'api.staging.example.com')).toBe('Staging');
		expect(envOfHost(envs, 'ssh-staging.example.com')).toBe('Staging');
		expect(envOfHost(envs, 'www.example.com')).toBe('Production');
		expect(envOfHost(envs, 'https://example.com/shop')).toBe('Production');
		expect(envOfHost(envs, 'staging.example.com/*')).toBe('Staging');
		expect(envOfHost(envs, '*.staging.example.com')).toBe('Staging');
		expect(envOfHost(envs, '*.example.com')).toBe('mixed: Production, Staging');
		expect(hostsIn('(http.host eq "staging.example.com") or (http.host in {"www.example.com"})')).toEqual([
			'http.host',
			'staging.example.com',
			'http.host',
			'www.example.com',
		]);
		expect(envOfHost(envs, 'other.org')).toBeNull();
		expect(envOfHosts(envs, ['example.com', 'staging.example.com'])).toBe('mixed: Production, Staging');
	});
	it('follows branches, servers and text', () => {
		expect(envOfBranch(envs, 'staging')).toBe('Staging');
		expect(envOfBranch(envs, 'main')).toBe('mixed: Local, Production');
		expect(envOfBranch(envs, 'feat/x')).toBeNull();
		expect(envOfBranch([{ name: 'production', label: 'Production', branch: '' }], 'main', 'main')).toBe(
			'Production',
		);
		const tags = { 'do:droplet:1': 'staging', 'do:droplet:2': 'production' };
		expect(envOfDroplets(envs, tags, [1])).toBe('Staging');
		expect(envOfDroplets(envs, tags, [1, 2])).toBe('mixed: Staging, Production');
		expect(envOfDroplets(envs, tags, [9])).toBeNull();
		expect(envOfText(envs, 'saha-textile-staging (42) destroyed')).toBe('Staging');
		expect(envOfText(envs, 'key linked')).toBeNull();
	});
});
