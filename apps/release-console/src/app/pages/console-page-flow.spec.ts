import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { describe, expect, it, vi } from 'vitest';

import { ConsolePage } from './console-page';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';

import type { Project } from '@saha-textile/release-console-contracts';

/** The page's members these tests use (protected on the component). */
interface Page {
	workspaces: () => string[];
	signInMessage: () => string;
	pinMessage: () => string;
	projectName(id: string | null): string;
	cloudsOf(p: Project): string[];
	edgesOf(p: Project): string[];
	savePassword(e: Event): Promise<void>;
	choose(method: 'pin' | 'password', pin: string): Promise<void>;
	changePin(e: Event, current: string, next: string): Promise<void>;
}

const PROJECT = {
	id: 'proj_1',
	name: 'Saha Textile',
	workspace: 'Own',
	repositories: [
		{ cloud: [{ vendor: 'digitalocean' }], edge: [{ vendor: 'cloudflare' }] },
		{ cloud: [{ vendor: 'digitalocean' }], edge: [] },
	],
} as unknown as Project;

function make(projects: Project[] | null) {
	const api = {
		lockStatus: vi.fn(async () => ({})),
		attentionCounts: vi.fn(async () => ({})),
		audit: vi.fn(async () => []),
		setPassword: vi.fn(async () => undefined),
		setPreferred: vi.fn(async () => undefined),
		changePin: vi.fn(async () => undefined),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ConsoleApi, useValue: api },
			{ provide: Router, useValue: { navigate: vi.fn(async () => true) } },
			{
				provide: ConsoleContext,
				useValue: { projects: { data: () => (projects ? { projects } : undefined) } },
			},
		],
	});
	TestBed.overrideComponent(ConsolePage, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ConsolePage);
	fixture.componentRef.setInput('page', 'settings');
	fixture.detectChanges();
	return { c: fixture.componentInstance as unknown as Page, api };
}
/** A sign-in form with the boxes it is given. */
function form(values: Record<string, string>): { event: Event; reset: ReturnType<typeof vi.fn> } {
	const el = document.createElement('form');
	for (const [name, value] of Object.entries(values))
		el.appendChild(Object.assign(document.createElement('input'), { name, value }));
	const reset = vi.fn();
	el.reset = reset;
	return { event: { preventDefault: vi.fn(), target: el } as unknown as Event, reset };
}

describe('the console page', () => {
	it('names projects, their workspaces, clouds and edges, before and after the list is read', () => {
		const none = make(null);
		expect(none.c.workspaces()).toEqual([]);
		expect(none.c.projectName('proj_1')).toBe('proj_1');
		const { c } = make([PROJECT]);
		expect(c.workspaces()).toEqual(['Own']);
		expect(c.projectName('proj_1')).toBe('Saha Textile');
		expect(c.projectName(null)).toBe('Console');
		expect(c.cloudsOf(PROJECT)).toEqual(['digitalocean']);
		expect(c.edgesOf(PROJECT)).toEqual(['cloudflare']);
	});

	it('saves a password only when it is long enough and typed twice', async () => {
		const { c, api } = make([PROJECT]);
		await c.savePassword(form({ pin: '123456', password: 'short', again: 'short' }).event);
		expect(c.signInMessage()).toBe('Use 12 or more characters.');
		await c.savePassword(form({ pin: '123456', password: 'long enough here' }).event);
		expect(c.signInMessage()).toBe('The two passwords differ.');
		const good = form({ pin: '123456', password: 'long enough here', again: 'long enough here' });
		await c.savePassword(good.event);
		expect(api.setPassword).toHaveBeenCalledWith('123456', 'long enough here');
		expect(c.signInMessage()).toBe('Password saved.');
		expect(good.reset).toHaveBeenCalled();
		await c.choose('pin', '123456');
		expect(c.signInMessage()).toBe('The lock screen now opens with the PIN.');
		await c.choose('password', '123456');
		expect(c.signInMessage()).toBe('The lock screen now opens with the password.');
	});

	it('changes the PIN when both are six digits, and says when it is refused', async () => {
		const { c, api } = make([PROJECT]);
		await c.changePin(form({}).event, '123', '654321');
		expect(c.pinMessage()).toBe('Both PINs are 6 digits.');
		await c.changePin(form({}).event, '123456', '65');
		expect(c.pinMessage()).toBe('Both PINs are 6 digits.');
		const ok = form({});
		await c.changePin(ok.event, '123456', '654321');
		expect(api.changePin).toHaveBeenCalledWith('123456', '654321');
		expect(c.pinMessage()).toBe('PIN changed.');
		expect(ok.reset).toHaveBeenCalled();
		api.changePin.mockRejectedValueOnce(new Error('Wrong PIN'));
		await c.changePin(form({}).event, '123456', '654321');
		expect(c.pinMessage()).toBe('Wrong PIN');
	});
});
