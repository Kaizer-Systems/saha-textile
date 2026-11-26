import { ChangeDetectionStrategy, Component, Injectable, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';

import {
	BACKUP_HOURS,
	BACKUP_SHARE,
	BACKUP_WEEKDAYS,
	DEDICATED_FAMILIES,
	IMAGE_KIND_NAMES,
	IMAGE_KINDS,
	SERVER_SIZES,
	SHARED_FAMILIES,
	SIZE_FAMILY_NAMES,
	VOLUME_PRICE_PER_GB,
	draftProblems,
	dropletCost,
	dropletRequestOf,
	namesFor,
	serverDraftOf,
	type DoCatalog,
	type DoImage,
	type DoRegion,
	type DoSize,
	type DropletDraft,
	type ImageKind,
	type SizeFamily,
} from '@saha-textile/release-console-contracts';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { VendorState } from './vendor-screens';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { when } from '../pages/format-time';
import { PIN_LENGTH, PinBoxes } from '../shared/pin-boxes';

/** The seven steps, in DigitalOcean's own order (brief v7, screens-do.js). */
export const DO_STEPS = [
	['region', 'Region'],
	['image', 'Image'],
	['size', 'Size'],
	['storage', 'Storage and backups'],
	['auth', 'Sign-in'],
	['network', 'Network and extras'],
	['finalize', 'Name and confirm'],
] as const;
/** Tabs that are another view of a step. */
const STEP_OF: Record<string, string> = { v5: 'size', imageOpen: 'image', confirm: 'finalize' };

const COUNTRY: Record<string, string> = {
	nyc: 'USA',
	sfo: 'USA',
	atl: 'USA',
	ric: 'USA',
	tor: 'Canada',
	lon: 'United Kingdom',
	ams: 'Netherlands',
	fra: 'Germany',
	blr: 'India',
	sgp: 'Singapore',
	syd: 'Australia',
};
export const countryOf = (slug: string): string => COUNTRY[slug.replace(/\d+$/, '')] ?? '';

/** The distributions in DigitalOcean's own order; any other follows. */
const OS_ORDER = ['Ubuntu', 'Debian', 'Fedora', 'CentOS', 'AlmaLinux', 'Rocky Linux'];

export const gb = (mb: number): string => (mb < 1024 ? `${mb} MB` : `${+(mb / 1024).toFixed(1)} GB`);
export const money = (n: number): string => `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
const disk = (s: DoSize): string => (s.family === 'regular' ? 'SSD' : 'NVMe SSD');
const ist = (utcHour: number): string => {
	const m = (utcHour * 60 + 330) % 1440;
	return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** The cheapest size of these families in a region with at least this much of everything. */
export function cheapestAtLeast(
	sizes: DoSize[],
	families: readonly SizeFamily[],
	region: string,
	min: { vcpus: number; memoryMb: number; diskGb: number },
): DoSize | undefined {
	return sizes
		.filter(
			(s) =>
				families.includes(s.family) &&
				s.available &&
				s.regions.includes(region) &&
				s.vcpus >= min.vcpus &&
				s.memoryMb >= min.memoryMb &&
				s.diskGb >= min.diskGb,
		)
		.sort((a, b) => a.priceMonthly - b.priceMonthly)[0];
}

/** One draft per repository, kept while the console is open, so leaving a step loses nothing. */
@Injectable({ providedIn: 'root' })
export class DropletDrafts {
	private readonly all = signal<Record<string, DropletDraft>>({});
	get(key: string): DropletDraft | undefined {
		return this.all()[key];
	}
	set(key: string, draft: DropletDraft): void {
		this.all.update((a) => ({ ...a, [key]: draft }));
	}
}

/** DigitalOcean › Droplets › the seven create steps, read live from DigitalOcean. */
@Component({
	selector: 'rc-do-create',
	imports: [VendorState, PinBoxes],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<rc-vendor-state
			vendor="DigitalOcean"
			[answer]="q.data()"
			[pending]="q.isPending()"
			[failed]="q.isError()"
		>
			@if (catalog(); as c) {
				@let d = draft();
				<div class="rc-banner cy small">
					<span class="rc-dot cy"></span>
					<div>
						<b>New droplet for {{ d.environment }}</b>
						· every choice on DigitalOcean's own create page, in the same order, read live
						{{ when(readAt()) }}. The console starts from the agreed {{ d.environment }} server; change
						anything before you confirm.
					</div>
					@if (envs().length > 1) {
						<div class="rc-row">
							@for (e of envs(); track e) {
								<button
									type="button"
									class="rc-chip"
									[class.on]="e === d.environment"
									(click)="useEnvironment(e)"
								>
									{{ e }}
								</button>
							}
						</div>
					}
				</div>
				@if (c.missing.length) {
					<div class="rc-banner amber small">
						<span class="rc-dot amber"></span>
						<div>
							<b>DigitalOcean did not let this key read: {{ c.missing.join(', ') }}.</b>
							Those choices stay empty until the key may read them.
						</div>
					</div>
				}
				<ol class="do-steps">
					@for (s of steps; track s[0]; let n = $index) {
						<li
							[class.done]="n < stepIndex()"
							[class.on]="n === stepIndex()"
							role="link"
							tabindex="0"
							(click)="go(s[0])"
							(keydown.enter)="go(s[0])"
						>
							<span>{{ n + 1 }}</span>
							{{ s[1] }}
						</li>
					}
				</ol>
				<div class="do-wiz">
					<div class="do-main">
						@switch (stepKey()) {
							@case ('region') {
								<div class="rc-panel">
									<div class="rc-ph">
										<span class="rc-label">Choose a region</span>
										<span class="do-api">GET /v2/regions</span>
									</div>
									<div class="do-grid">
										@for (r of c.regions; track r.slug) {
											<div
												class="do-card"
												role="radio"
												tabindex="0"
												[attr.aria-checked]="r.slug === d.region"
												[class.on]="r.slug === d.region"
												[class.dim]="!r.available"
												(click)="pickRegion(r)"
												(keydown.enter)="pickRegion(r)"
											>
												<b>{{ r.name }}</b>
												<small>
													{{ countryOf(r.slug) }}
													@if (countryOf(r.slug)) {
														·
													}
													<span class="rc-mono">{{ r.slug }}</span>
													@if (!r.available) {
														<br />
														takes no new droplets now
													} @else if (r.slug === planRegion) {
														<br />
														the agreed server region
													}
												</small>
											</div>
										}
									</div>
								</div>
								<div class="rc-panel">
									<div class="rc-ph">
										<span class="rc-label">Private network (VPC)</span>
										<span class="do-api">GET /v2/vpcs</span>
									</div>
									<div class="rc-row">
										<div
											class="do-radio"
											role="radio"
											tabindex="0"
											[attr.aria-checked]="d.vpcId === null"
											[class.on]="d.vpcId === null"
											(click)="patch({ vpcId: null })"
											(keydown.enter)="patch({ vpcId: null })"
										>
											<i aria-hidden="true"></i>
											<span>
												<b>The region's default</b>
												<small>
													{{ defaultVpc()?.name ?? 'made by DigitalOcean on first use' }}
													@if (defaultVpc(); as v) {
														·
														<span class="rc-mono">{{ v.ipRange }}</span>
													}
												</small>
											</span>
										</div>
										@for (v of regionVpcs(); track v.id) {
											@if (!v.isDefault) {
												<div
													class="do-radio"
													role="radio"
													tabindex="0"
													[attr.aria-checked]="d.vpcId === v.id"
													[class.on]="d.vpcId === v.id"
													(click)="patch({ vpcId: v.id })"
													(keydown.enter)="patch({ vpcId: v.id })"
												>
													<i aria-hidden="true"></i>
													<span>
														<b>{{ v.name }}</b>
														<small class="rc-mono">{{ v.ipRange }}</small>
													</span>
												</div>
											}
										}
									</div>
									<p class="rc-note">
										Droplets in the same VPC talk over private addresses. Give staging and
										production separate VPCs so neither can reach the other.
									</p>
								</div>
							}
							@case ('image') {
								<div class="rc-panel">
									<div class="rc-ph">
										<span class="rc-label">Choose an image</span>
										<span class="do-api">GET /v2/images · /v2/droplets/:id/backups</span>
									</div>
									<div class="rc-tabs">
										@for (k of imageKinds; track k) {
											<span
												role="tab"
												tabindex="0"
												[class.on]="k === imageTab()"
												[attr.aria-selected]="k === imageTab()"
												(click)="imageTab.set(k)"
												(keydown.enter)="imageTab.set(k)"
											>
												{{ imageKindNames[k] }}
												@if (k !== 'os' && k !== 'app') {
													· {{ imagesOf(k).length }}
												}
											</span>
										}
									</div>
									@switch (imageTab()) {
										@case ('os') {
											<div class="do-grid six">
												@for (g of osGroups(); track g.name) {
													<div
														class="do-card"
														role="radio"
														tabindex="0"
														[attr.aria-checked]="g.name === chosenOs()?.name"
														[class.on]="g.name === chosenOs()?.name"
														(click)="pickImage(g.versions[0])"
														(keydown.enter)="pickImage(g.versions[0])"
													>
														<b>{{ g.name }}</b>
														<small>
															{{
																g.name === chosenOs()?.name
																	? chosenImage()?.name
																	: g.versions[0]?.name
															}}
															· {{ g.versions.length }}
															{{ g.versions.length === 1 ? 'version' : 'versions' }}
														</small>
													</div>
												}
											</div>
											@if (chosenOs(); as g) {
												<div class="do-drop">
													@for (v of g.versions; track v.id) {
														<span
															role="radio"
															tabindex="0"
															[attr.aria-checked]="isChosen(v)"
															[class.on]="isChosen(v)"
															(click)="pickImage(v)"
															(keydown.enter)="pickImage(v)"
														>
															{{ v.name }}
															@if (v.slug === planImage) {
																· our servers use this
															}
															@if (v.regions.length && !v.regions.includes(d.region)) {
																· not in {{ d.region }}
															}
														</span>
													}
												</div>
											}
										}
										@case ('app') {
											<div class="rc-msearch">
												<input
													type="search"
													placeholder="Search the Marketplace: Docker, WordPress, Node.js…"
													aria-label="Search the Marketplace"
													[value]="appSearch()"
													(input)="appSearch.set($any($event.target).value)"
												/>
											</div>
											<div class="do-grid">
												@for (i of apps(); track i.id) {
													<div
														class="do-card"
														role="radio"
														tabindex="0"
														[attr.aria-checked]="isChosen(i)"
														[class.on]="isChosen(i)"
														(click)="pickImage(i)"
														(keydown.enter)="pickImage(i)"
													>
														<b>{{ i.name }}</b>
														<small>
															{{ i.distribution }} · at least {{ i.minDiskGb }} GB disk
														</small>
													</div>
												} @empty {
													<p class="rc-note">No Marketplace image matches.</p>
												}
											</div>
											<p class="rc-note">
												{{ apps().length }} of {{ imagesOf('app').length }} shown; search
												narrows the list.
											</p>
										}
										@default {
											<div class="rc-tw">
												<table class="rc-t">
													<thead>
														<tr>
															<th></th>
															<th>Name</th>
															@if (imageTab() === 'backup') {
																<th>Droplet</th>
															}
															<th>Made</th>
															<th>Size</th>
															<th>Smallest disk</th>
															<th>Regions</th>
														</tr>
													</thead>
													<tbody>
														@for (i of imagesOf(imageTab()); track i.id) {
															<tr
																[class.sel]="isChosen(i)"
																role="radio"
																tabindex="0"
																[attr.aria-checked]="isChosen(i)"
																(click)="pickImage(i)"
																(keydown.enter)="pickImage(i)"
															>
																<td>
																	<span
																		class="rc-dot"
																		[class.cy]="isChosen(i)"
																	></span>
																</td>
																<td>
																	<b>{{ i.name }}</b>
																</td>
																@if (imageTab() === 'backup') {
																	<td class="rc-mono">{{ i.of }}</td>
																}
																<td class="rc-mono">{{ when(i.createdAt) }}</td>
																<td class="rc-mono">
																	{{ i.sizeGb === null ? '—' : i.sizeGb + ' GB' }}
																</td>
																<td class="rc-mono">{{ i.minDiskGb }} GB</td>
																<td class="rc-mono">
																	{{ i.regions.join(', ') || '—' }}
																</td>
															</tr>
														} @empty {
															<tr>
																<td colspan="7">None on this account.</td>
															</tr>
														}
													</tbody>
												</table>
											</div>
										}
									}
									<p class="rc-note">
										Versions and the Marketplace are listed live, so a new Ubuntu appears by itself.
									</p>
								</div>
							}
							@case ('size') {
								<div class="rc-panel">
									<div class="rc-ph">
										<span class="rc-label">Choose a size</span>
										<span class="do-api">GET /v2/sizes</span>
									</div>
									<div class="rc-tabs">
										<span
											class="on"
											aria-selected="true"
											role="tab"
										>
											Bundled plans
										</span>
										<span
											role="tab"
											tabindex="0"
											(click)="go('v5')"
											(keydown.enter)="go('v5')"
										>
											Build your own (sliders)
										</span>
									</div>
									<div class="rc-row">
										@for (g of cpuGroups; track g.key) {
											<div
												class="do-radio"
												role="radio"
												tabindex="0"
												[attr.aria-checked]="g.key === cpuGroup()"
												[class.on]="g.key === cpuGroup()"
												(click)="pickGroup(g.key)"
												(keydown.enter)="pickGroup(g.key)"
											>
												<i aria-hidden="true"></i>
												<span>
													<b>{{ g.label }}</b>
													<small>{{ g.note }}</small>
												</span>
											</div>
										}
									</div>
									@if (cpuGroup() !== 'gpu') {
										<span class="rc-label">
											{{ cpuGroup() === 'shared' ? 'CPU option' : 'Kind' }}
										</span>
										<div class="rc-row">
											@for (f of groupFamilies(); track f) {
												<div
													class="do-radio"
													role="radio"
													tabindex="0"
													[attr.aria-checked]="f === d.sizeFamily"
													[class.on]="f === d.sizeFamily"
													(click)="pickFamily(f)"
													(keydown.enter)="pickFamily(f)"
												>
													<i aria-hidden="true"></i>
													<span>
														<b>{{ familyNames[f] }}</b>
														<small>{{ familyCount(f) }} sizes in {{ d.region }}</small>
													</span>
												</div>
											}
										</div>
									}
									<div class="do-grid sizes">
										@for (s of familySizes(); track s.slug) {
											<div
												class="do-card"
												role="radio"
												tabindex="0"
												[attr.aria-checked]="s.slug === d.size"
												[class.on]="s.slug === d.size"
												[class.dim]="!offered(s)"
												(click)="pickSize(s)"
												(keydown.enter)="pickSize(s)"
											>
												<b>
													{{ money(s.priceMonthly) }}
													<small>/mo</small>
												</b>
												<small>
													{{ gb(s.memoryMb) }} · {{ s.vcpus }} vCPU
													<br />
													{{ s.diskGb }} GB {{ disk(s) }} · {{ s.transferTb }} TB transfer
													@if (!offered(s)) {
														<br />
														not in {{ d.region }}
													}
												</small>
												@if (s.slug === planSize()) {
													<em class="do-tag">{{ d.environment }} plan</em>
												}
											</div>
										} @empty {
											<p class="rc-note">DigitalOcean lists no sizes of this kind.</p>
										}
									</div>
									<p class="rc-note">
										Prices, memory, disk and transfer per size, read live with the regions each is
										offered in.
									</p>
								</div>
							}
							@case ('v5') {
								<div class="rc-panel">
									<div class="rc-ph">
										<span class="rc-label">Choose a size</span>
										<span class="do-api">GET /v2/sizes</span>
									</div>
									<div class="rc-tabs">
										<span
											role="tab"
											tabindex="0"
											(click)="go('size')"
											(keydown.enter)="go('size')"
										>
											Bundled plans
										</span>
										<span
											class="on"
											aria-selected="true"
											role="tab"
										>
											Build your own (sliders)
										</span>
									</div>
									<div class="rc-row">
										@for (g of sliderGroups; track g.key) {
											<div
												class="do-radio"
												role="radio"
												tabindex="0"
												[attr.aria-checked]="g.key === sliderGroup()"
												[class.on]="g.key === sliderGroup()"
												(click)="sliderGroup.set(g.key)"
												(keydown.enter)="sliderGroup.set(g.key)"
											>
												<i aria-hidden="true"></i>
												<span>
													<b>{{ g.label }}</b>
													<small>{{ g.note }}</small>
												</span>
											</div>
										}
									</div>
									@for (sl of sliders(); track sl.key) {
										<div class="do-slider">
											<span class="rc-label">{{ sl.label }}</span>
											<span
												class="do-track"
												role="slider"
												tabindex="0"
												[attr.aria-label]="sl.label"
												[attr.aria-valuemin]="0"
												[attr.aria-valuemax]="sl.values.length - 1"
												[attr.aria-valuenow]="sl.index"
												[attr.aria-valuetext]="sl.text"
												(pointerdown)="slide(sl.key, $event)"
												(pointermove)="slideMove(sl.key, $event)"
												(keydown)="slideKey(sl.key, $event)"
											>
												<i [style.width.%]="sl.pct"></i>
												<b [style.left.%]="sl.pct"></b>
											</span>
											<span class="rc-mono">{{ sl.text }}</span>
											<small>up to {{ sl.max }}</small>
										</div>
									}
									@if (sliderPick(); as s) {
										<div class="do-grid sizes">
											<div
												class="do-card"
												role="radio"
												tabindex="0"
												[attr.aria-checked]="s.slug === d.size"
												[class.on]="s.slug === d.size"
												(click)="pickSize(s)"
												(keydown.enter)="pickSize(s)"
											>
												<b>
													{{ money(s.priceMonthly) }}
													<small>/mo</small>
												</b>
												<small>
													<span class="rc-mono">{{ s.slug }}</span>
													<br />
													{{ gb(s.memoryMb) }} · {{ s.vcpus }} vCPU · {{ s.diskGb }} GB
													{{ disk(s) }}
												</small>
											</div>
										</div>
									} @else {
										<div class="rc-banner amber small">
											<span class="rc-dot amber"></span>
											<div>
												No size in {{ d.region }} has that much of everything. Move a slider
												down.
											</div>
										</div>
									}
									<div class="rc-banner amber small">
										<span class="rc-dot amber"></span>
										<div>
											Only in datacenters that offer it ({{ sliderSizes().length }} combinations
											in {{ d.region }}), and a droplet cannot move between this and a bundled
											plan later. The console names it by its size code, the same way the API
											does.
										</div>
									</div>
								</div>
							}
							@case ('storage') {
								<div class="rc-panel">
									<div class="rc-ph">
										<span class="rc-label">Extra storage</span>
										<span class="do-api">POST /v2/volumes · then volumes: [id]</span>
									</div>
									<div
										class="do-tick"
										role="checkbox"
										tabindex="0"
										[attr.aria-checked]="d.volumeGb > 0"
										[class.on]="d.volumeGb > 0"
										(click)="patch({ volumeGb: d.volumeGb > 0 ? 0 : 100 })"
										(keydown.enter)="patch({ volumeGb: d.volumeGb > 0 ? 0 : 100 })"
									>
										<i aria-hidden="true"></i>
										<span>
											<b>Add a block storage volume</b>
											<small>{{ money(volumePrice) }} per GB a month</small>
										</span>
										@if (d.volumeGb === 0) {
											<em>not needed: the shop's data fits the droplet's disk</em>
										}
									</div>
									<div
										[class.do-faded]="d.volumeGb === 0"
										class="rc-form"
									>
										<label>
											Size, GB
											<span class="rc-msearch">
												<input
													type="number"
													min="1"
													max="16384"
													aria-label="Volume size in GB"
													[disabled]="d.volumeGb === 0"
													[value]="d.volumeGb || 100"
													(change)="setVolume($any($event.target).value)"
												/>
											</span>
										</label>
										<label>
											Name
											<span class="rc-mono">
												{{ d.names[0] }}-data · {{ money(d.volumeGb * volumePrice) }}/mo
											</span>
										</label>
										<div class="rc-row">
											@for (f of volumeFormats; track f.key) {
												<div
													class="do-radio"
													role="radio"
													tabindex="0"
													[attr.aria-checked]="f.key === d.volumeFormat"
													[class.on]="f.key === d.volumeFormat"
													(click)="patch({ volumeFormat: f.key })"
													(keydown.enter)="patch({ volumeFormat: f.key })"
												>
													<i aria-hidden="true"></i>
													<span>
														<b>{{ f.label }}</b>
														<small>{{ f.note }}</small>
													</span>
												</div>
											}
										</div>
									</div>
								</div>
								<div class="rc-panel">
									<div class="rc-ph">
										<span class="rc-label">DigitalOcean backups</span>
										<span class="do-api">backups + backup_policy</span>
									</div>
									<div class="rc-row">
										@for (b of backupPlans(); track b.key) {
											<div
												class="do-radio"
												role="radio"
												tabindex="0"
												[attr.aria-checked]="b.key === d.backups"
												[class.on]="b.key === d.backups"
												(click)="patch({ backups: b.key })"
												(keydown.enter)="patch({ backups: b.key })"
											>
												<i aria-hidden="true"></i>
												<span>
													<b>{{ b.label }}</b>
													<small>{{ b.note }}</small>
												</span>
											</div>
										}
									</div>
									<div [class.do-faded]="d.backups === 'off'">
										@if (d.backups === 'weekly') {
											<span class="rc-label">Day</span>
											<div class="rc-row">
												@for (w of weekdays; track w) {
													<button
														type="button"
														class="rc-chip"
														[class.on]="w === d.backupWeekday"
														(click)="patch({ backupWeekday: w })"
													>
														{{ w }}
													</button>
												}
											</div>
										}
										<span class="rc-label">Window starts (4 hours, UTC · IST)</span>
										<div class="rc-row">
											@for (h of hours; track h) {
												<button
													type="button"
													class="rc-chip"
													[class.on]="h === d.backupHour"
													[disabled]="d.backups === 'off'"
													(click)="patch({ backupHour: h })"
												>
													{{ h.toString().padStart(2, '0') }}:00 · {{ ist(h) }}
												</button>
											}
										</div>
									</div>
									<p class="rc-note">
										The shop's own nightly database backup to Spaces runs whatever is chosen here;
										these are whole-disk copies on top.
									</p>
								</div>
							}
							@case ('auth') {
								<div class="rc-panel">
									<div class="rc-ph">
										<span class="rc-label">SSH keys on this DigitalOcean account</span>
										<span class="do-api">GET /v2/account/keys</span>
									</div>
									@for (k of c.sshKeys; track k.id) {
										<div
											class="do-tick"
											role="checkbox"
											tabindex="0"
											[attr.aria-checked]="d.sshKeyIds.includes(k.id)"
											[class.on]="d.sshKeyIds.includes(k.id)"
											(click)="toggleKey(k.id)"
											(keydown.enter)="toggleKey(k.id)"
										>
											<i aria-hidden="true"></i>
											<span>
												<b>{{ k.name }}</b>
												<small class="rc-mono">{{ k.fingerprint }}</small>
											</span>
										</div>
									} @empty {
										<p class="rc-note">No SSH keys on this DigitalOcean account yet.</p>
									}
								</div>
								<div class="rc-panel">
									<div class="rc-ph"><span class="rc-label">What happens to each choice</span></div>
									<div class="rc-kv">
										<div>
											<span>Keys picked here</span>
											<em>go on root, which the first-boot file locks: no root sign-in</em>
										</div>
										<div>
											<span>No key at all</span>
											<em class="amber">DigitalOcean would email a root password, so pick one</em>
										</div>
										<div>
											<span>Your own sign-in</span>
											<em class="ok">the admin user, SSH only through the Cloudflare tunnel</em>
										</div>
										<div>
											<span>Password sign-in over SSH</span>
											<em class="ok">always off in the first-boot file</em>
										</div>
										<div>
											<span>Recovery Console password</span>
											<em>the admin's, set from its hash; the password stays in NordPass</em>
										</div>
									</div>
								</div>
							}
							@case ('network') {
								<div class="rc-panel">
									<div class="rc-ph"><span class="rc-label">Network</span></div>
									<div class="do-tick on">
										<i aria-hidden="true"></i>
										<span>
											<b>Public IPv4 address</b>
											<small>always: Cloudflare reaches the shop through it</small>
										</span>
									</div>
									<div
										class="do-tick"
										role="checkbox"
										tabindex="0"
										[attr.aria-checked]="d.ipv6"
										[class.on]="d.ipv6"
										(click)="patch({ ipv6: !d.ipv6 })"
										(keydown.enter)="patch({ ipv6: !d.ipv6 })"
									>
										<i aria-hidden="true"></i>
										<span>
											<b>Public IPv6 address</b>
											<small>free · can also be turned on later</small>
										</span>
									</div>
									<div class="do-tick on">
										<i aria-hidden="true"></i>
										<span>
											<b>Private address in the VPC</b>
											<small>always on</small>
										</span>
									</div>
								</div>
								<div class="rc-panel">
									<div class="rc-ph"><span class="rc-label">Monitoring and agents</span></div>
									<div
										class="do-tick"
										role="checkbox"
										tabindex="0"
										[attr.aria-checked]="d.monitoring"
										[class.on]="d.monitoring"
										(click)="patch({ monitoring: !d.monitoring })"
										(keydown.enter)="patch({ monitoring: !d.monitoring })"
									>
										<i aria-hidden="true"></i>
										<span>
											<b>Metrics agent (improved monitoring)</b>
											<small>free · memory, disk and load graphs and alerts</small>
										</span>
									</div>
									<div
										class="do-tick"
										role="checkbox"
										tabindex="0"
										[attr.aria-checked]="d.agent"
										[class.on]="d.agent"
										(click)="patch({ agent: !d.agent })"
										(keydown.enter)="patch({ agent: !d.agent })"
									>
										<i aria-hidden="true"></i>
										<span>
											<b>Droplet console agent</b>
											<small>lets DigitalOcean's web console open a shell</small>
										</span>
									</div>
								</div>
								<div class="rc-panel">
									<div class="rc-ph">
										<span class="rc-label">First-boot file (startup script)</span>
										<span class="do-api">user_data</span>
									</div>
									<div
										class="do-tick"
										role="checkbox"
										tabindex="0"
										[attr.aria-checked]="d.firstBoot"
										[class.on]="d.firstBoot"
										(click)="patch({ firstBoot: !d.firstBoot })"
										(keydown.enter)="patch({ firstBoot: !d.firstBoot })"
									>
										<i aria-hidden="true"></i>
										<span>
											<b>docker/production/first-boot.yaml</b>
											<small>
												admin and deploy users, SSH on 127.0.0.1 only, Docker, cloudflared, UFW,
												swap, patches
											</small>
										</span>
										@if (!d.firstBoot) {
											<em>a bare server: no deploy can reach it</em>
										}
									</div>
									<p class="rc-note">
										Its values (your keys, the admin's password hash, the tunnel's token) are filled
										in on this Mac when you create; they never reach the browser.
									</p>
								</div>
								<div class="rc-panel">
									<div class="rc-ph"><span class="rc-label">Applied right after creation</span></div>
									<div class="rc-kv">
										<div>
											<span>Cloud Firewall</span>
											<em class="ok">{{ d.names[0] }} · 443 from Cloudflare's ranges only</em>
										</div>
										<div>
											<span>Project</span>
											<em>{{ projectName() }}</em>
										</div>
										<div>
											<span>DNS records at Cloudflare</span>
											<em>{{ domains().join(', ') || 'none for this environment' }}</em>
										</div>
									</div>
								</div>
							}
							@case ('finalize') {
								<div class="rc-panel">
									<div class="rc-ph"><span class="rc-label">Name and place</span></div>
									<div class="rc-form">
										<label>
											How many
											<span class="rc-msearch">
												<input
													type="number"
													min="1"
													max="10"
													aria-label="How many droplets"
													[value]="d.quantity"
													(change)="setQuantity($any($event.target).value)"
												/>
											</span>
										</label>
										<label>
											Name
											<span class="rc-msearch">
												<input
													type="text"
													aria-label="Droplet name"
													[value]="d.names[0]"
													(change)="setName($any($event.target).value)"
												/>
											</span>
										</label>
										@if (d.quantity > 1) {
											<label>
												All names
												<span class="rc-mono">{{ d.names.join(', ') }}</span>
											</label>
										}
										<label>
											Tags
											<span class="rc-msearch multi">
												@for (t of d.tags; track t) {
													<span class="rc-pill cy">
														{{ t }}
														<button
															type="button"
															class="rc-flag"
															[attr.aria-label]="'Remove tag ' + t"
															(click)="removeTag(t)"
														>
															✕
														</button>
													</span>
												}
												<input
													type="text"
													placeholder="add a tag, Enter"
													aria-label="Add a tag"
													(keydown.enter)="addTag($any($event.target))"
												/>
											</span>
										</label>
									</div>
									<span class="rc-label">Project</span>
									<div class="rc-row">
										@for (p of c.projects; track p.id) {
											<div
												class="do-radio"
												role="radio"
												tabindex="0"
												[attr.aria-checked]="p.id === d.projectId"
												[class.on]="p.id === d.projectId"
												(click)="patch({ projectId: p.id })"
												(keydown.enter)="patch({ projectId: p.id })"
											>
												<i aria-hidden="true"></i>
												<span>
													<b>{{ p.name }}</b>
													<small>{{ p.isDefault ? 'the account default' : 'project' }}</small>
												</span>
											</div>
										}
									</div>
									<p class="rc-note">
										Tags are how the console and the metrics screens find a server, so a new droplet
										appears everywhere by itself. Up to 10 droplets in one request.
									</p>
								</div>
								<div class="rc-panel">
									<div class="rc-ph"><span class="rc-label">Before you create</span></div>
									<div class="rc-kv">
										<div>
											<span>Monthly cost</span>
											<em class="amber">
												{{ money(cost().total) }} (about {{ money(cost().hourly) }} an hour)
											</em>
										</div>
										<div>
											<span>DNS records to add</span>
											<em>{{ domains().join(', ') || 'none' }}</em>
										</div>
										<div>
											<span>Written to the audit log</span>
											<em class="ok">yes, with the full request</em>
										</div>
									</div>
								</div>
								@if (problems().length) {
									<div class="rc-banner amber small">
										<span class="rc-dot amber"></span>
										<div>
											<b>Not ready to create:</b>
											@for (p of problems(); track p) {
												<br />
												{{ p }}
											}
										</div>
									</div>
								}
							}
						}
						<div class="rc-row between do-nav">
							<button
								type="button"
								class="rc-btn ghost"
								(click)="back()"
							>
								{{ stepIndex() === 0 ? 'Cancel' : '‹ Back' }}
							</button>
							@if (stepIndex() < steps.length - 1) {
								<button
									type="button"
									class="rc-btn primary"
									(click)="next()"
								>
									Next: {{ nextLabel() }} ›
								</button>
							} @else {
								<button
									type="button"
									class="rc-btn"
									[class.primary]="d.environment !== 'production'"
									[class.danger]="d.environment === 'production'"
									[disabled]="problems().length > 0"
									(click)="go('confirm')"
								>
									<span
										class="lock"
										aria-hidden="true"
									></span>
									Create {{ d.environment }} droplet
								</button>
							}
						</div>
					</div>
					<div class="rc-panel do-sum">
						<div class="rc-ph"><span class="rc-label">Your droplet</span></div>
						<div class="rc-kv">
							@for (row of summary(); track row[0]) {
								<div>
									<span>{{ row[0] }}</span>
									<em [class]="row[2]">{{ row[1] }}</em>
								</div>
							}
						</div>
						<div class="do-cost">
							<b>{{ money(cost().total) }}</b>
							<span>a month · about {{ money(cost().hourly) }} an hour</span>
						</div>
						<details class="do-curl">
							<summary>The request the console will send</summary>
							<pre class="rc-mono">
POST https://api.digitalocean.com/v2/droplets
{{ requestText() }}</pre>
						</details>
						<p class="rc-note">
							Prices and lists are read live from DigitalOcean each time you open this, so new sizes,
							regions and OS versions appear by themselves.
						</p>
					</div>
				</div>
				@if (step() === 'confirm') {
					<div
						class="rc-modal-back"
						(keydown.escape)="go('finalize')"
					>
						<form
							class="rc-modal"
							role="dialog"
							[attr.aria-label]="'Create ' + d.names[0]"
							(submit)="$event.preventDefault(); create()"
						>
							<h3 class="rc-h">Create {{ d.names[0] }}</h3>
							<p class="rc-p">
								A new {{ d.environment }} server, billed at
								<b>{{ money(cost().total) }} a month</b>
								from now.
								@if (isProduction()) {
									The shop keeps running where it is; nothing moves to this server until a deploy and
									the DNS switch.
								} @else {
									It is billed by the hour and stops costing when you destroy it.
								}
							</p>
							<div class="rc-form">
								<label>
									Type {{ d.environment }}
									<span class="rc-msearch">
										<input
											type="text"
											autocomplete="off"
											[attr.aria-label]="'Type ' + d.environment + ' to confirm'"
											[value]="typed()"
											(input)="typed.set($any($event.target).value)"
										/>
									</span>
								</label>
								<label>
									Admin password
									<span class="rc-msearch">
										<input
											type="password"
											autocomplete="new-password"
											aria-label="Admin password for the Recovery Console"
											(input)="password.set($any($event.target).value)"
										/>
									</span>
								</label>
								<label>
									Once more
									<span class="rc-msearch">
										<input
											type="password"
											autocomplete="new-password"
											aria-label="Admin password again"
											(input)="password2.set($any($event.target).value)"
										/>
									</span>
								</label>
								<label>
									May sign in over SSH
									<span class="rc-msearch multi">
										@for (e of emails(); track e) {
											<span class="rc-pill cy">
												{{ e }}
												<button
													type="button"
													class="rc-flag"
													[attr.aria-label]="'Remove ' + e"
													(click)="removeEmail(e)"
												>
													✕
												</button>
											</span>
										}
										<input
											type="email"
											placeholder="an email, Enter"
											aria-label="Add a person who may sign in over SSH"
											(keydown.enter)="$event.preventDefault(); addEmail($any($event.target))"
											(blur)="addEmail($any($event.target))"
										/>
									</span>
								</label>
								<label>
									PIN
									<rc-pin-boxes
										label="Console PIN to create"
										[autofocus]="false"
										[disabled]="busy()"
										(changed)="pin.set($event)"
									/>
								</label>
							</div>
							<p class="rc-note">
								The admin password opens the Recovery Console when the network is down. It is hashed on
								this Mac into the first-boot file and never kept: save it in NordPass first.
							</p>
							@if (confirmProblem(); as why) {
								<div class="rc-banner amber small">
									<span class="rc-dot amber"></span>
									<div>{{ why }}</div>
								</div>
							}
							@if (message(); as m) {
								<div class="rc-banner red small">
									<span class="rc-dot red"></span>
									<div>{{ m }}</div>
								</div>
							}
							<div class="rc-row end">
								<button
									type="button"
									class="rc-btn ghost"
									(click)="go('finalize')"
								>
									Cancel
								</button>
								<button
									type="submit"
									class="rc-btn"
									[class.primary]="!isProduction()"
									[class.danger]="isProduction()"
									[disabled]="!!confirmProblem() || busy()"
								>
									<span
										class="lock"
										aria-hidden="true"
									></span>
									{{ busy() ? 'Starting…' : 'Create and pay' }}
								</button>
							</div>
						</form>
					</div>
				}
			}
		</rc-vendor-state>
	`,
})
export class DoCreateScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly router = inject(Router);
	private readonly drafts = inject(DropletDrafts);
	readonly step = input('region');

	protected readonly when = when;
	protected readonly gb = gb;
	protected readonly money = money;
	protected readonly disk = disk;
	protected readonly ist = ist;
	protected readonly countryOf = countryOf;
	protected readonly steps = DO_STEPS;
	protected readonly imageKinds = IMAGE_KINDS;
	protected readonly imageKindNames = IMAGE_KIND_NAMES;
	protected readonly familyNames = SIZE_FAMILY_NAMES;
	protected readonly weekdays = BACKUP_WEEKDAYS;
	protected readonly hours = BACKUP_HOURS;
	protected readonly volumePrice = VOLUME_PRICE_PER_GB;
	protected readonly planRegion = serverDraftOf('x', 'staging').region;
	protected readonly planImage = serverDraftOf('x', 'staging').image;
	protected readonly cpuGroups = [
		{ key: 'shared', label: 'Shared CPU · Basic', note: 'bursty work; the shop servers use it' },
		{ key: 'dedicated', label: 'Dedicated CPU', note: 'steady heavy work' },
		{ key: 'gpu', label: 'GPU', note: 'GPU droplets, not for the shop' },
	] as const;
	protected readonly sliderGroups = [
		{ key: 'shared', label: 'Shared CPU', note: 'v5 Shared' },
		{ key: 'dedicated', label: 'Dedicated CPU', note: 'v5 General Purpose' },
	] as const;
	protected readonly volumeFormats = [
		{ key: 'ext4', label: 'Format ext4 and mount', note: 'at /mnt/<name>' },
		{ key: 'xfs', label: 'Format XFS and mount', note: 'at /mnt/<name>' },
		{ key: 'none', label: 'Leave it raw', note: 'format it yourself' },
	] as const;

	private readonly slot = computed(() => this.ctx.repo()?.cloud.find((c) => c.vendor === 'digitalocean')?.id ?? '');
	protected readonly q = injectQuery(() => ({
		queryKey: ['vendor', 'do-catalog', this.ctx.projectId(), this.ctx.repoId(), this.slot()],
		queryFn: () => this.api.doCatalog(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', this.slot()),
		enabled: !!this.slot(),
		staleTime: 5 * 60_000,
	}));
	protected readonly catalog = computed<DoCatalog | null>(() => {
		const a = this.q.data();
		return a?.state === 'ok' ? a.data : null;
	});
	protected readonly readAt = computed(() => {
		const a = this.q.data();
		return a?.state === 'ok' ? a.readAt : null;
	});

	/** The repository's environments that run on this DigitalOcean account. */
	protected readonly envs = computed(() => {
		const on = (this.ctx.repo()?.environments ?? []).filter((e) => e.cloudId === this.slot()).map((e) => e.name);
		return on.length ? on : ['staging'];
	});
	private readonly key = computed(() => `${this.ctx.projectId()}/${this.ctx.repoId()}`);
	protected readonly draft = computed<DropletDraft>(() => {
		const kept = this.drafts.get(this.key());
		if (kept) return kept;
		// envs() is never empty: it falls back to staging itself.
		const first = this.envs().find((e) => !/prod/i.test(e)) ?? (this.envs()[0] as string);
		return serverDraftOf(this.ctx.projectId() ?? 'project', first);
	});

	protected readonly stepKey = computed(() => {
		const s = this.step();
		return s === 'imageOpen' ? 'image' : s === 'confirm' ? 'finalize' : s;
	});
	protected readonly stepIndex = computed(() => {
		const k = STEP_OF[this.step()] ?? this.step();
		return Math.max(
			0,
			DO_STEPS.findIndex(([s]) => s === k),
		);
	});

	protected readonly imageTab = signal<ImageKind>('os');
	protected readonly appSearch = signal('');
	protected readonly sliderGroup = signal<'shared' | 'dedicated'>('shared');
	private readonly sliderAt = signal<Record<string, number>>({});

	constructor() {
		// The DigitalOcean project named like this console project, once the lists arrive.
		effect(() => {
			const c = this.catalog();
			const d = this.draft();
			if (!c || d.projectId) return;
			const name = (this.ctx.project()?.name ?? '').toLowerCase();
			const match = c.projects.find((p) => p.name.toLowerCase() === name) ?? c.projects.find((p) => p.isDefault);
			if (match) this.patch({ projectId: match.id });
		});
	}

	protected patch(p: Partial<DropletDraft>): void {
		this.drafts.set(this.key(), { ...this.draft(), ...p });
	}

	protected readonly nextLabel = computed(() => DO_STEPS[this.stepIndex() + 1]?.[1] ?? '');

	protected go(tab: string): void {
		void this.router.navigate([], { queryParams: { tab }, queryParamsHandling: 'merge' });
	}
	protected next(): void {
		const n = DO_STEPS[this.stepIndex() + 1];
		if (n) this.go(n[0]);
	}
	protected back(): void {
		const p = DO_STEPS[this.stepIndex() - 1];
		this.go(p ? p[0] : 'list');
	}

	protected useEnvironment(environment: string): void {
		const fresh = serverDraftOf(this.ctx.projectId() ?? 'project', environment);
		const d = this.draft();
		this.drafts.set(this.key(), { ...fresh, sshKeyIds: d.sshKeyIds, projectId: d.projectId });
	}

	// ---- region
	protected readonly regionVpcs = computed(() =>
		(this.catalog()?.vpcs ?? []).filter((v) => v.region === this.draft().region),
	);
	protected readonly defaultVpc = computed(() => this.regionVpcs().find((v) => v.isDefault));
	protected pickRegion(r: DoRegion): void {
		if (!r.available) return;
		const d = this.draft();
		const vpcOk = d.vpcId && this.catalog()?.vpcs.some((v) => v.id === d.vpcId && v.region === r.slug);
		this.patch({ region: r.slug, vpcId: vpcOk ? d.vpcId : null });
	}

	// ---- image
	protected imagesOf(kind: ImageKind): DoImage[] {
		return (this.catalog()?.images ?? []).filter((i) => i.kind === kind);
	}
	protected readonly osGroups = computed(() => {
		const groups = new Map<string, DoImage[]>();
		for (const i of this.imagesOf('os')) {
			// DigitalOcean's GPU-ready images run only on GPU sizes: their own group, last.
			const name = i.slug?.startsWith('gpu-') ? `${i.distribution} for GPU droplets` : i.distribution;
			groups.set(name, [...(groups.get(name) ?? []), i]);
		}
		const rank = (n: string) => OS_ORDER.indexOf(n) + 1 || 99;
		return [...groups.entries()]
			.map(([name, versions]) => ({
				name,
				versions: versions.sort(
					(a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name),
				),
			}))
			.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
	});
	protected readonly chosenImage = computed(() => {
		const d = this.draft();
		return (this.catalog()?.images ?? []).find((i) =>
			typeof d.image === 'number' ? i.id === d.image : i.slug === d.image,
		);
	});
	protected readonly chosenOs = computed(() => {
		const img = this.chosenImage();
		return img?.kind === 'os' ? this.osGroups().find((g) => g.versions.some((v) => v.id === img.id)) : undefined;
	});
	protected readonly apps = computed(() => {
		const q = this.appSearch().trim().toLowerCase();
		return this.imagesOf('app')
			.filter((i) => !q || `${i.name} ${i.distribution}`.toLowerCase().includes(q))
			.sort((a, b) => a.name.localeCompare(b.name))
			.slice(0, 60);
	});
	protected isChosen(i: DoImage): boolean {
		return this.chosenImage()?.id === i.id;
	}
	protected pickImage(i: DoImage | undefined): void {
		if (!i) return;
		this.patch({
			imageKind: i.kind,
			image: i.slug && i.kind !== 'snapshot' && i.kind !== 'backup' ? i.slug : i.id,
		});
	}

	// ---- size
	protected readonly cpuGroup = computed(() => {
		const f = this.draft().sizeFamily;
		return SHARED_FAMILIES.includes(f) ? 'shared' : f === 'gpu' ? 'gpu' : 'dedicated';
	});
	protected readonly groupFamilies = computed(() =>
		this.cpuGroup() === 'shared' ? SHARED_FAMILIES : DEDICATED_FAMILIES,
	);
	protected readonly planSize = computed(() => SERVER_SIZES[this.draft().environment] ?? '');
	protected offered(s: DoSize): boolean {
		return s.available && s.regions.includes(this.draft().region);
	}
	protected familyCount(f: SizeFamily): number {
		return (this.catalog()?.sizes ?? []).filter((s) => s.family === f && this.offered(s)).length;
	}
	protected readonly familySizes = computed(() =>
		(this.catalog()?.sizes ?? [])
			.filter((s) => s.family === this.draft().sizeFamily)
			.sort((a, b) => Number(this.offered(b)) - Number(this.offered(a)) || a.priceMonthly - b.priceMonthly),
	);
	protected pickGroup(g: 'shared' | 'dedicated' | 'gpu'): void {
		this.pickFamily(g === 'shared' ? 'regular' : g === 'gpu' ? 'gpu' : 'general');
	}
	protected pickFamily(f: SizeFamily): void {
		const first = (this.catalog()?.sizes ?? [])
			.filter((s) => s.family === f && this.offered(s))
			.sort((a, b) => a.priceMonthly - b.priceMonthly)[0];
		this.patch({ sizeFamily: f, size: first?.slug ?? this.draft().size });
	}
	protected pickSize(s: DoSize): void {
		if (!this.offered(s)) return;
		this.patch({ sizeFamily: s.family, size: s.slug });
	}

	// ---- sliders: real sizes only
	protected readonly sliderSizes = computed(() => {
		const fams: readonly SizeFamily[] = this.sliderGroup() === 'shared' ? ['v5shared'] : ['v5general'];
		return (this.catalog()?.sizes ?? []).filter((s) => fams.includes(s.family) && this.offered(s));
	});
	private valuesOf(key: 'vcpus' | 'memoryMb' | 'diskGb'): number[] {
		return [...new Set(this.sliderSizes().map((s) => s[key]))].sort((a, b) => a - b);
	}
	protected readonly sliders = computed(() => {
		const at = this.sliderAt();
		const current = this.catalog()?.sizes.find((s) => s.slug === this.draft().size);
		const make = (key: 'vcpus' | 'memoryMb' | 'diskGb', label: string, fmt: (n: number) => string) => {
			const values = this.valuesOf(key);
			const fallback = current
				? Math.max(
						0,
						values.findIndex((v) => v >= current[key]),
					)
				: 0;
			const index = Math.min(at[key] ?? fallback, Math.max(0, values.length - 1));
			const value = values[index] ?? 0;
			return {
				key,
				label,
				values,
				index,
				value,
				text: fmt(value),
				max: fmt(values[values.length - 1] ?? 0),
				pct: values.length > 1 ? (index / (values.length - 1)) * 100 : 0,
			};
		};
		return [
			make('vcpus', 'vCPU', (n) => String(n)),
			make('memoryMb', 'Memory', gb),
			make('diskGb', 'Disk', (n) => `${n} GB`),
		] as const;
	});
	protected readonly sliderPick = computed(() => {
		// sliders() always answers its three sliders, in this order.
		const [cpu, mem, dsk] = this.sliders();
		const fams: readonly SizeFamily[] = this.sliderGroup() === 'shared' ? ['v5shared'] : ['v5general'];
		return cheapestAtLeast(this.catalog()?.sizes ?? [], fams, this.draft().region, {
			vcpus: cpu.value,
			memoryMb: mem.value,
			diskGb: dsk.value,
		});
	});
	private setSlider(key: string, index: number): void {
		const sl = this.sliders().find((s) => s.key === key);
		if (!sl) return;
		const i = Math.max(0, Math.min(sl.values.length - 1, index));
		this.sliderAt.update((a) => ({ ...a, [key]: i }));
		const s = this.sliderPick();
		if (s) this.patch({ sizeFamily: s.family, size: s.slug });
	}
	protected slide(key: string, e: PointerEvent): void {
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture?.(e.pointerId);
		this.slideTo(key, e, el);
	}
	protected slideMove(key: string, e: PointerEvent): void {
		if (e.buttons === 1) this.slideTo(key, e, e.currentTarget as HTMLElement);
	}
	private slideTo(key: string, e: PointerEvent, el: HTMLElement): void {
		const sl = this.sliders().find((s) => s.key === key);
		if (!sl || sl.values.length < 2) return;
		const r = el.getBoundingClientRect();
		const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
		this.setSlider(key, Math.round(ratio * (sl.values.length - 1)));
	}
	protected slideKey(key: string, e: KeyboardEvent): void {
		const sl = this.sliders().find((s) => s.key === key);
		if (!sl) return;
		const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
		if (step === undefined) return;
		e.preventDefault();
		this.setSlider(key, sl.index + step);
	}

	// ---- storage
	protected readonly backupPlans = computed(() => {
		const price = this.catalog()?.sizes.find((s) => s.slug === this.draft().size)?.priceMonthly ?? 0;
		return [
			{ key: 'off' as const, label: 'Off', note: 'the shop backs up its database to Spaces nightly' },
			{
				key: 'weekly' as const,
				label: 'Weekly',
				note: `kept 4 weeks · +${money(price * BACKUP_SHARE.weekly)}/mo (20%)`,
			},
			{
				key: 'daily' as const,
				label: 'Daily',
				note: `kept 7 days · +${money(price * BACKUP_SHARE.daily)}/mo (30%)`,
			},
		];
	});
	protected setVolume(v: string): void {
		const n = Math.round(Number(v));
		if (Number.isFinite(n)) this.patch({ volumeGb: Math.max(1, Math.min(16384, n)) });
	}

	// ---- sign-in
	protected toggleKey(id: number): void {
		const ids = this.draft().sshKeyIds;
		this.patch({ sshKeyIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] });
	}

	// ---- finalize
	protected setQuantity(v: string): void {
		const n = Math.max(1, Math.min(10, Math.round(Number(v)) || 1));
		this.patch({ quantity: n, names: namesFor(this.draft().names[0] as string, n) });
	}
	protected setName(v: string): void {
		const name = v.trim();
		if (name) this.patch({ names: namesFor(name, this.draft().quantity) });
	}
	protected addTag(input: HTMLInputElement): void {
		const t = input.value.trim();
		input.value = '';
		if (t && !this.draft().tags.includes(t)) this.patch({ tags: [...this.draft().tags, t] });
	}
	protected removeTag(t: string): void {
		this.patch({ tags: this.draft().tags.filter((x) => x !== t) });
	}

	protected readonly projectName = computed(() => {
		const id = this.draft().projectId;
		return this.catalog()?.projects.find((p) => p.id === id)?.name ?? 'the account default';
	});
	/** The environment's own domains, which get Cloudflare records after the droplet is up. */
	protected readonly domains = computed(
		() => this.ctx.repo()?.environments.find((e) => e.name === this.draft().environment)?.domains ?? [],
	);

	// ---- summary
	protected readonly size = computed(() => this.catalog()?.sizes.find((s) => s.slug === this.draft().size));
	protected readonly cost = computed(() => dropletCost(this.draft(), this.size()));
	// ---- confirm (PIN, typed name, the admin's Recovery Console password)
	protected readonly typed = signal('');
	protected readonly password = signal('');
	protected readonly password2 = signal('');
	protected readonly pin = signal('');
	protected readonly busy = signal(false);
	protected readonly message = signal('');
	protected readonly isProduction = computed(() => /prod/i.test(this.draft().environment));
	/** Who may sign in over SSH: the project's list, changed here before the create if needed. */
	private readonly emailEdits = signal<string[] | null>(null);
	protected readonly emails = computed(() => this.emailEdits() ?? this.ctx.project()?.sshEmails ?? []);
	protected addEmail(input: HTMLInputElement): void {
		const e = input.value.trim().toLowerCase();
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return;
		input.value = '';
		if (!this.emails().includes(e)) this.emailEdits.set([...this.emails(), e]);
	}
	protected removeEmail(e: string): void {
		this.emailEdits.set(this.emails().filter((x) => x !== e));
	}
	protected readonly confirmProblem = computed(() => {
		if (this.problems().length) return this.problems()[0] as string;
		if (this.typed().trim() !== this.draft().environment) return `Type ${this.draft().environment} to confirm.`;
		const pw = this.password();
		if (pw.length < 12) return 'The admin password needs at least 12 characters.';
		if (pw !== this.password2()) return 'The two passwords differ.';
		if (!this.emails().length) return 'Add at least one person who may sign in over SSH.';
		if (this.pin().length !== PIN_LENGTH) return 'Type your console PIN.';
		return '';
	});
	protected async create(): Promise<void> {
		if (this.confirmProblem() || this.busy()) return;
		this.busy.set(true);
		this.message.set('');
		try {
			const job = await this.api.createDroplet(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', this.slot(), {
				pin: this.pin(),
				confirm: this.typed().trim(),
				draft: this.draft(),
				adminPassword: this.password(),
				sshEmails: this.emails(),
			});
			this.password.set('');
			this.password2.set('');
			void this.router.navigate([], {
				queryParams: { tab: 'creating', job: job.id },
				queryParamsHandling: 'merge',
			});
		} catch (err) {
			this.message.set(err instanceof Error ? err.message : 'The console API did not answer.');
		} finally {
			this.busy.set(false);
		}
	}

	protected readonly problems = computed(() => {
		const c = this.catalog();
		return c ? draftProblems(this.draft(), c) : [];
	});
	protected readonly requestText = computed(() => JSON.stringify(dropletRequestOf(this.draft()), null, 2));
	protected readonly summary = computed<[string, string, string][]>(() => {
		const d = this.draft();
		const c = this.catalog();
		const reached = (k: string) => this.stepIndex() >= DO_STEPS.findIndex(([s]) => s === k);
		const region = c?.regions.find((r) => r.slug === d.region);
		const img = this.chosenImage();
		const s = this.size();
		const keys = (c?.sshKeys ?? []).filter((k) => d.sshKeyIds.includes(k.id)).map((k) => k.name);
		const row = (step: string, label: string, value: string, cls = ''): [string, string, string] =>
			reached(step) ? [label, value, cls] : [label, '—', 'muted'];
		return [
			row('region', 'Region', `${region?.name ?? d.region} · ${d.vpcId ? 'own VPC' : 'default VPC'}`, 'cy'),
			row('image', 'Image', img ? `${img.distribution} ${img.name}` : String(d.image), 'cy'),
			row(
				'size',
				'Size',
				s ? `${SIZE_FAMILY_NAMES[s.family]} · ${gb(s.memoryMb)} · ${s.vcpus} vCPU · ${s.diskGb} GB` : d.size,
				'cy',
			),
			row(
				'storage',
				'Volume and backups',
				`${d.volumeGb ? `${d.volumeGb} GB volume` : 'no volume'} · backups ${d.backups}`,
			),
			row(
				'auth',
				'Sign-in',
				keys.length ? `SSH key ${keys.join(', ')}` : 'no key picked',
				keys.length ? 'ok' : 'amber',
			),
			row(
				'network',
				'Network',
				[
					d.ipv6 ? 'IPv4 + IPv6' : 'IPv4',
					d.monitoring ? 'metrics agent' : '',
					d.firstBoot ? 'first-boot file' : '',
				]
					.filter(Boolean)
					.join(' · '),
			),
			row('finalize', 'Name', `${d.names.join(', ')} · ${this.projectName()}`),
		];
	});
}
