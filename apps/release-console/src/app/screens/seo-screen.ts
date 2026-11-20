import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { type Job, type SitemapResult, sitemapResultSchema } from '@saha-textile/release-console-contracts';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { ConsoleState } from '../data/console-state';
import { Icon } from '../shared/icons';

/** "Page not found" answers are read again every 5 minutes while open (brief's refresh table). */
export const NOT_FOUND_REFRESH_MS = 5 * 60 * 1000;
/** A running sitemap check is followed every 2 seconds. */
export const SITEMAP_POLL_MS = 2000;

/** A sitemap check's result, from the last line of its job that carries one. */
export function sitemapResultOf(job: Job | null | undefined): SitemapResult | null {
	for (const line of [...(job?.lines ?? [])].reverse()) {
		const parsed = sitemapResultSchema.safeParse(line.event?.['result']);
		if (parsed.success) return parsed.data;
	}
	return null;
}

/** How far a running check has got, from its newest progress line. */
export function sitemapProgressOf(job: Job | null | undefined): { checked: number; total: number } | null {
	for (const line of [...(job?.lines ?? [])].reverse()) {
		const p = line.event?.['progress'] as { checked?: unknown; total?: unknown } | undefined;
		if (p && typeof p.checked === 'number' && typeof p.total === 'number')
			return { checked: p.checked, total: p.total };
	}
	return null;
}

/** Whether the sitemap lists a path: yes, no, or unknown before a check (or for a grouped route). */
export function inSitemap(route: string, result: SitemapResult | null): 'yes' | 'no' | '—' {
	if (!result || route.includes(':id') || route.endsWith('…')) return '—';
	return result.paths.includes(route) ? 'yes' : 'no';
}

/** This computer's stack: the shop and the admin on the stack's HTTPS port. */
export function localSites(port: number): { shop: string; admin: string } {
	const p = port === 443 ? '' : `:${port}`;
	return {
		shop: `https://local.saha-textile.localhost${p}`,
		admin: `https://admin-local.saha-textile.localhost${p}`,
	};
}

/**
 * The action the brief draws for a missing path: a path the sitemap still lists is a page that
 * should exist, so it opens (a product, or a page); any other gets a redirect in the admin's
 * Redirects page with the path filled in. A grouped route (`:id`, `…`) gets neither.
 */
export function missingAction(
	route: string,
	listed: 'yes' | 'no' | '—',
	sites: { shop: string; admin: string },
): { label: string; href: string } | null {
	if (route.includes(':id') || route.endsWith('…')) return null;
	if (listed === 'yes')
		return { label: route.startsWith('/product/') ? 'Open product' : 'Open page', href: `${sites.shop}${route}` };
	return { label: 'Add redirect', href: `${sites.admin}/redirect/create?source=${encodeURIComponent(route)}` };
}

/**
 * Search engines (brief 26gq3NbcbBESea6abRtsa3, screen 5), our own checks: does every page in the
 * sitemap still answer, which addresses started answering "page not found" and where those visitors
 * came from. Google's own figures come once the Search Console key is set up.
 */
@Component({
	selector: 'rc-seo-screen',
	imports: [Icon],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-g4">
			<div class="rc-stat">
				<span class="rc-label">
					<rc-icon name="tabler/sitemap" />
					Sitemap check
				</span>
				@if (result(); as r) {
					<b
						[class.ok]="r.ok === r.checked && r.checked > 0"
						[class.amber]="r.ok < r.checked"
					>
						{{ r.ok }} / {{ r.checked }}
					</b>
					<small>pages answer 200 · {{ when(r.at) }}</small>
				} @else if (running()) {
					<b>{{ progress()?.checked ?? 0 }} / {{ progress()?.total ?? '…' }}</b>
					<small>checking, 4 pages a second</small>
				} @else {
					<b>—</b>
					<small>not checked yet</small>
				}
			</div>
			<div class="rc-stat">
				<span class="rc-label">
					<rc-icon name="tabler/file-x" />
					New “page not found”
				</span>
				<b [class.amber]="(missing.data()?.total ?? 0) > 0">{{ missing.data()?.total ?? '—' }}</b>
				<small>last 24 h · {{ missing.data()?.paths?.length ?? 0 }} paths</small>
			</div>
			<div class="rc-stat">
				<span class="rc-label">
					<rc-icon name="tabler/arrows-exchange" />
					Redirects
				</span>
				<b>{{ result()?.redirects ?? '—' }}</b>
				<small>sitemap pages that redirect</small>
			</div>
			<div class="rc-stat">
				<span class="rc-label">
					<rc-icon name="tabler/world-search" />
					Google · 28 days
				</span>
				<b>—</b>
				<small>needs the Search Console key</small>
			</div>
		</div>

		<div class="rc-panel">
			<div class="rc-ph">
				<span class="rc-label">
					<rc-icon name="tabler/sitemap" />
					Sitemap · {{ sitemapLabel() }}
				</span>
				<button
					type="button"
					class="rc-btn primary"
					[disabled]="running() || starting()"
					(click)="check()"
				>
					{{ running() ? 'Checking…' : 'Check the sitemap' }}
				</button>
			</div>
			@if (message()) {
				<p class="rc-note">{{ message() }}</p>
			}
			@if (result(); as r) {
				<div class="rc-states">
					<span class="rc-pill ok">{{ r.ok }} answer 200</span>
					<span
						class="rc-pill"
						[class.amber]="r.redirects > 0"
					>
						{{ r.redirects }} redirect
					</span>
					<span
						class="rc-pill"
						[class.red]="r.notFound > 0"
					>
						{{ r.notFound }} not found
					</span>
					<span
						class="rc-pill"
						[class.red]="r.other > 0"
					>
						{{ r.other }} other
					</span>
					<span class="rc-pill muted">{{ r.listed }} listed</span>
				</div>
				@if (r.note) {
					<p class="rc-note">{{ r.note }}</p>
				}
				@if (r.failures.length) {
					<div class="rc-tw">
						<table class="rc-t">
							<thead>
								<tr>
									<th>Path in the sitemap</th>
									<th>Answered</th>
								</tr>
							</thead>
							<tbody>
								@for (f of r.failures; track f.path) {
									<tr>
										<td class="rc-mono">{{ f.path }}</td>
										<td
											[class.red]="f.status === 0 || f.status >= 400"
											[class.amber]="f.status >= 300 && f.status < 400"
										>
											{{ f.status || 'no answer' }}
										</td>
									</tr>
								}
							</tbody>
						</table>
					</div>
				}
			} @else {
				<p class="rc-note">
					Reads {{ onThisComputer() ? 'this computer’s stack' : 'the environment’s site' }}, then asks for
					every page the sitemap lists, at most four a second, without following redirects. Run it after a
					release.
				</p>
			}
		</div>

		<div class="rc-panel">
			<div class="rc-ph">
				<span class="rc-label">
					<rc-icon name="tabler/file-x" />
					“Page not found” in the shop · last 24 h · {{ readAt() }}
				</span>
				<button
					type="button"
					class="rc-btn ghost"
					[disabled]="missing.isFetching()"
					(click)="missing.refetch()"
				>
					Check again
				</button>
			</div>
			@if (!onThisComputer()) {
				<p class="rc-note">
					These come from this computer’s stack. A server’s own log is read once its server is linked.
				</p>
			}
			@if (missing.data(); as m) {
				@if (m.source === 'none' && !m.total) {
					<p class="rc-note">The stack’s edge is not running, so there is no request log to read.</p>
				}
				<div class="rc-tw">
					<table class="rc-t">
						<thead>
							<tr>
								<th>Path</th>
								<th>Times</th>
								<th>Came from</th>
								<th>In the sitemap</th>
								<th>Last</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							@for (p of m.paths; track p.route) {
								<tr>
									<td class="rc-mono">{{ p.route }}</td>
									<td class="rc-mono">{{ p.count }}</td>
									<td>{{ p.from.length ? p.from.join(', ') : '—' }}</td>
									<td [class.red]="sitemapOf(p.route) === 'yes'">{{ sitemapOf(p.route) }}</td>
									<td class="rc-mono">{{ when(p.lastAt) }}</td>
									<td>
										@if (actionOf(p.route); as a) {
											<a
												class="rc-btn"
												[class.primary]="a.label === 'Add redirect'"
												[class.ghost]="a.label !== 'Add redirect'"
												[href]="a.href"
												target="_blank"
												rel="noopener"
											>
												{{ a.label }}
											</a>
										}
									</td>
								</tr>
							} @empty {
								<tr>
									<td colspan="6">No “page not found” answers in the last 24 hours.</td>
								</tr>
							}
						</tbody>
					</table>
				</div>
				<p class="rc-note">
					Paths only: query strings and visitor details are never kept, and “came from” is the referring
					site’s name. A path the sitemap lists but the shop cannot find is shown red.
				</p>
			} @else {
				<p class="rc-note">Reading the request log…</p>
			}
		</div>
	`,
})
export class SeoScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly state = inject(ConsoleState);
	protected readonly starting = signal(false);
	protected readonly message = signal('');

	protected readonly onThisComputer = computed(() => {
		const env = this.ctx.repo()?.environments.find((e) => e.name === this.state.environment());
		return !env || env.cloudId === null;
	});
	protected readonly missing = injectQuery(() => ({
		queryKey: ['not-found'],
		queryFn: () => this.api.notFound(24),
		refetchOnMount: 'always' as const,
		refetchInterval: NOT_FOUND_REFRESH_MS,
	}));
	/** The newest sitemap check the helper knows, followed closely while it runs. */
	protected readonly latest = injectQuery(() => ({
		queryKey: ['sitemap-check'],
		queryFn: async () => {
			const seo = (await this.api.jobs()).filter((j) => j.kind === 'seo');
			const newest = seo.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
			return newest ? this.api.job(newest.id) : null;
		},
		refetchOnMount: 'always' as const,
		refetchInterval: (q: { state: { data?: Job | null } }) =>
			q.state.data?.status === 'running' ? SITEMAP_POLL_MS : false,
	}));
	protected readonly running = computed(() => this.latest.data()?.status === 'running');
	protected readonly result = computed(() => sitemapResultOf(this.latest.data()));
	protected readonly progress = computed(() => sitemapProgressOf(this.latest.data()));
	protected readonly sitemapLabel = computed(() => {
		const r = this.result();
		return r ? `${r.origin}${r.sitemap}` : 'every page it lists, one at a time';
	});
	protected readonly readAt = computed(() =>
		this.missing.dataUpdatedAt()
			? `read ${new Date(this.missing.dataUpdatedAt()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
			: 'reading…',
	);

	/** The stack's HTTPS port, for links to this computer's shop and admin. */
	private readonly health = injectQuery(() => ({
		queryKey: ['shop-health'],
		queryFn: () => this.api.shopHealth(),
		staleTime: 60_000,
	}));
	protected actionOf(route: string): { label: string; href: string } | null {
		return missingAction(route, this.sitemapOf(route), localSites(this.health.data()?.stackPort ?? 443));
	}
	protected sitemapOf(route: string): 'yes' | 'no' | '—' {
		return inSitemap(route, this.result());
	}
	protected when(iso: string): string {
		return new Date(iso).toLocaleString('en-IN', {
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
		});
	}

	protected async check(): Promise<void> {
		this.starting.set(true);
		this.message.set('');
		try {
			await this.api.sitemapCheck({
				projectId: this.ctx.projectId() ?? '',
				repositoryId: this.ctx.repoId() ?? '',
				environment: this.state.environment(),
			});
			await this.latest.refetch();
		} catch (err) {
			this.message.set((err as Error).message);
		} finally {
			this.starting.set(false);
		}
	}
}
