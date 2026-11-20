import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';

import { VENDOR_NAMES } from '@saha-textile/release-console-contracts';

import { AlertsScreen } from './alerts-screen';
import { ApmScreen } from './apm-screen';
import { DeployScreen, HealthScreen, InfraScreen, ServerScreen, TailScreen } from './local-screens';
import { OverviewScreen } from './overview-screen';
import { PlannedScreen } from './planned-screen';
import { SecretsScreen } from './secrets-screen';
import { ServerDeployScreen } from './server-deploy-screen';
import { ServicesScreen } from './services-screen';
import {
	CfDomainsScreen,
	DnsScreen,
	DoAccountScreen,
	DropletsScreen,
	PipelinesScreen,
	PullsScreen,
} from './vendor-screens';
import { ConsoleContext } from '../data/console-context';
import { placeOf } from '../menu/menu-search';
import { Icon, environmentIcon, screenIcon } from '../shared/icons';
import { VendorLogo } from '../shared/vendor-logo';

const SCREEN_LATER = /^later-/;

/** Screens with live data, and the tab that shows it. Every other tab stays the planned screen. */
export const LIVE_TABS: Record<string, string | string[] | null> = {
	overview: null,
	services: null,
	deploy: 'local',
	server: 'normal',
	infra: 'map',
	tail: ['follow', 'errors', 'request'],
	health: 'normal',
	alerts: ['rules', 'firing'],
	apm: ['services', 'endpoint'],
	secrets: ['matrix', 'problem'],
	pulls: 'list',
	pipeline: 'list',
	droplets: 'list',
	doaccount: 'overview',
	cfdomains: 'list',
	dns: 'records',
};

/** One repository screen: its place in that repository's menu, its tabs and its body. */
@Component({
	selector: 'rc-screen-page',
	imports: [
		OverviewScreen,
		ServicesScreen,
		PlannedScreen,
		PullsScreen,
		PipelinesScreen,
		DropletsScreen,
		DoAccountScreen,
		CfDomainsScreen,
		DnsScreen,
		Icon,
		VendorLogo,
		DeployScreen,
		ServerDeployScreen,
		ServerScreen,
		InfraScreen,
		TailScreen,
		HealthScreen,
		AlertsScreen,
		ApmScreen,
		SecretsScreen,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@let s = info();
		<div class="rc-row between rc-head">
			<div>
				<span class="rc-crumb">{{ crumb() }}</span>
				<h2 class="rc-title">
					@if (s) {
						@if (titleVendor(); as tv) {
							<rc-vendor-logo
								[vendor]="tv"
								[named]="false"
								[size]="20"
							/>
						} @else {
							<rc-icon [name]="icon()" />
						}
					}
					{{ s?.label ?? (ctx.projects.isPending() ? '' : 'Not in this repository') }}
				</h2>
			</div>
			@if (tabs().length > 1) {
				<div class="rc-states">
					@for (t of tabs(); track t.key) {
						@if (t.off) {
							<span
								class="rc-chip off"
								aria-disabled="true"
								[attr.data-tip]="t.off"
							>
								{{ t.label }}
							</span>
						} @else {
							<button
								type="button"
								class="rc-chip"
								[class.on]="t.key === tabKey()"
								[class.part]="!!t.part"
								[attr.data-tip]="t.part"
								(click)="openTab(t.key)"
							>
								@if (tabIcon(t.key); as ti) {
									<rc-icon [name]="ti" />
								}
								{{ t.label }}
							</button>
						}
					}
				</div>
			}
		</div>
		<div class="rc-content">
			@if (laterVendor(); as v) {
				<div class="rc-banner amber small">
					<span class="rc-dot amber"></span>
					<div>
						<b>{{ v }} screens later.</b>
						This repository's source code is on {{ v }}; its own screens are built the way {{ v }} works
						when it is first needed.
					</div>
				</div>
			}
			@if (!s) {
				@if (ctx.projects.isSuccess()) {
					<p class="rc-p muted">
						This screen is not in this repository's menu. Search finds only what this repository has.
					</p>
				}
			} @else if (screen().startsWith('later-')) {
				<div class="rc-banner amber small">
					<span class="rc-dot amber"></span>
					<div>
						<b>Screens later.</b>
						{{ s.captions['list'] }}
					</div>
				</div>
			} @else if (live()) {
				@switch (screen()) {
					@case ('overview') {
						<rc-overview-screen />
					}
					@case ('services') {
						<rc-services-screen />
					}
					@case ('pulls') {
						<rc-pulls-screen />
					}
					@case ('pipeline') {
						<rc-pipelines-screen />
					}
					@case ('droplets') {
						<rc-droplets-screen />
					}
					@case ('doaccount') {
						<rc-do-account-screen />
					}
					@case ('cfdomains') {
						<rc-cf-domains-screen />
					}
					@case ('deploy') {
						@if (deployOnServer()) {
							<rc-server-deploy-screen [environment]="tabKey()" />
						} @else {
							<rc-deploy-screen />
						}
					}
					@case ('server') {
						<rc-server-screen />
					}
					@case ('infra') {
						<rc-infra-screen />
					}
					@case ('tail') {
						<rc-tail-screen [mode]="tabKey()" />
					}
					@case ('health') {
						<rc-health-screen />
					}
					@case ('secrets') {
						<rc-secrets-screen [tab]="tabKey()" />
					}
					@case ('apm') {
						<rc-apm-screen [tab]="tabKey()" />
					}
					@case ('alerts') {
						<rc-alerts-screen [tab]="tabKey()" />
					}
					@case ('dns') {
						<rc-dns-screen />
					}
				}
			} @else {
				<rc-planned-screen
					[info]="s"
					[tab]="tabKey()"
				/>
			}
		</div>
	`,
})
export class ScreenPage {
	private readonly router = inject(Router);
	protected readonly ctx = inject(ConsoleContext);
	readonly screen = input('overview');
	readonly tab = input<string | undefined>(undefined);

	private readonly place = computed(() => {
		const m = this.ctx.repoMenu();
		return m ? placeOf(m) : new Map<string, string[]>();
	});
	protected readonly info = computed(() => this.ctx.repoMenu()?.screens[this.screen()]);
	protected readonly icon = computed(() => screenIcon(this.screen()));
	/** A provider's placeholder screen ("screens later") shows that provider's logo. */
	protected readonly titleVendor = computed(() =>
		SCREEN_LATER.test(this.screen())
			? this.ctx.repoMenu()?.menu.find((g) => g.subs.some((sub) => sub.items.includes(this.screen())))?.vendor
			: undefined,
	);
	protected readonly crumb = computed(() => {
		const p = this.place().get(this.screen()) ?? [];
		const head = [this.ctx.project()?.name, this.ctx.repo()?.name].filter(Boolean).join(' › ');
		return this.screen() === 'overview' || !p.length ? `${head} ›` : `${head} › ${p.join(' › ')} ›`;
	});
	protected readonly tabs = computed(() => {
		const s = this.info();
		if (!s) return [];
		return Object.entries(s.states)
			.filter(([, label]) => !!label)
			.map(([key, label]) => ({
				key,
				label,
				off: s.offStates?.[key] ?? null,
				part: s.partStates?.[key] ?? null,
			}));
	});
	protected readonly tabKey = computed(() => {
		const wanted = this.tab();
		const usable = this.tabs().filter((t) => !t.off);
		return usable.find((t) => t.key === wanted)?.key ?? usable[0]?.key ?? '';
	});
	protected readonly live = computed(() => {
		const tab = LIVE_TABS[this.screen()];
		if (tab === null) return true;
		// Live deploy is live on every environment: this computer runs the local pipeline, a server deploy.yml.
		if (this.screen() === 'deploy') return !!this.ctx.repo()?.environments.some((e) => e.name === this.tabKey());
		if (tab === undefined) return false;
		return Array.isArray(tab) ? tab.includes(this.tabKey()) : tab === this.tabKey();
	});
	/** The open Live deploy tab is an environment that runs on a server. */
	protected readonly deployOnServer = computed(
		() => (this.ctx.repo()?.environments.find((e) => e.name === this.tabKey())?.cloudId ?? null) !== null,
	);
	/** A repository whose source-code vendor has no screens yet shows the Ship screens with a note. */
	protected readonly laterVendor = computed(() => {
		const repo = this.ctx.repo();
		if (!repo || repo.sourceCode.vendor === 'github') return null;
		return this.place().get(this.screen())?.[0] === 'Ship' ? VENDOR_NAMES[repo.sourceCode.vendor] : null;
	});

	/** Live deploy's tabs are environments, each with its icon. */
	protected tabIcon(key: string): string | null {
		if (this.screen() !== 'deploy') return null;
		const env = this.ctx.repo()?.environments.find((e) => e.name === key);
		return env ? environmentIcon(env.name, env.cloudId === null) : null;
	}

	protected openTab(key: string): void {
		void this.router.navigate([], { queryParams: { tab: key }, queryParamsHandling: 'merge' });
	}
}
