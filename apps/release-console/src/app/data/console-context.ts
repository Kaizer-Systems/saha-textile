import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { filter, map } from 'rxjs';

import { ConsoleApi } from './console-api';
import { ConsoleSession } from './session';
import { repositoryMenu } from '../menu/repo-menu';

import type { Environment } from '@saha-textile/release-console-contracts';

export type Level = 'console' | 'project' | 'repository';

/**
 * Where the owner is: the console level (`/console/…`), a project (`/p/:project/…`) or one of its
 * repositories (`/p/:project/r/:repo/…`). Everything a level shows, search included, comes from here.
 */
@Injectable({ providedIn: 'root' })
export class ConsoleContext {
	private readonly router = inject(Router);
	private readonly api = inject(ConsoleApi);
	private readonly session = inject(ConsoleSession);

	private readonly url = toSignal(
		this.router.events.pipe(
			filter((e): e is NavigationEnd => e instanceof NavigationEnd),
			map((e) => e.urlAfterRedirects),
		),
		{ initialValue: this.router.url },
	);
	private readonly parts = computed(() =>
		(this.url().split(/[?#]/)[0] ?? '').split('/').filter(Boolean).map(decodeURIComponent),
	);

	readonly level = computed<Level>(() => {
		const p = this.parts();
		if (p[0] !== 'p') return 'console';
		return p[2] === 'r' ? 'repository' : 'project';
	});
	readonly projectId = computed(() => (this.parts()[0] === 'p' ? (this.parts()[1] ?? null) : null));
	readonly repoId = computed(() => (this.level() === 'repository' ? (this.parts()[3] ?? null) : null));
	/** The open page: a console page, a project page or a repository screen. */
	/** The open tab (`?tab=`), for the loader's words. */
	readonly tab = computed(() => new URLSearchParams(this.url().split('?')[1]?.split('#')[0] ?? '').get('tab'));
	readonly page = computed(() => {
		const p = this.parts();
		if (this.level() === 'console') return p[1] ?? 'projects';
		if (this.level() === 'project') return p[2] ?? 'overview';
		return p[4] ?? 'overview';
	});

	readonly projects = injectQuery(() => ({
		queryKey: ['projects'],
		queryFn: () => this.api.projects(),
		enabled: !!this.session.token(),
	}));
	readonly project = computed(() => this.projects.data()?.projects.find((p) => p.id === this.projectId()) ?? null);
	readonly repo = computed(() => this.project()?.repositories.find((r) => r.id === this.repoId()) ?? null);
	readonly repoMenu = computed(() => {
		const r = this.repo();
		return r ? repositoryMenu(r) : null;
	});

	/** The repository's environments; at project level, every environment name its repositories use. */
	readonly environments = computed<Environment[]>(() => {
		const repo = this.repo();
		if (repo) return repo.environments;
		const seen = new Map<string, Environment>();
		for (const r of this.project()?.repositories ?? [])
			for (const e of r.environments) if (!seen.has(e.name)) seen.set(e.name, e);
		return [...seen.values()];
	});
}
