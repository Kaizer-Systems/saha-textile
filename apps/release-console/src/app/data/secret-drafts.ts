import { Injectable, computed, signal } from '@angular/core';

import type { SecretTier } from '@saha-textile/release-console-contracts';

/** One waiting change on Run › Secrets. Its value lives only here, in memory, until Save. */
export interface SecretDraft {
	tier: SecretTier;
	folder: string;
	name: string;
	value: string;
}

const keyOf = (d: Pick<SecretDraft, 'tier' | 'folder' | 'name'>) => `${d.tier}|${d.folder}|${d.name}`;

/**
 * The Secrets screen's drafts, per tier. They survive moving between screens and are dropped when
 * the console locks or the page closes; they are never stored in the browser, a link or a log.
 */
@Injectable({ providedIn: 'root' })
export class SecretDrafts {
	private readonly all = signal<Record<string, SecretDraft>>({});
	/** Rows whose box is open, drafts or not. */
	private readonly open = signal<Set<string>>(new Set());
	readonly count = computed(() => Object.keys(this.all()).length);

	of(tier: SecretTier): SecretDraft[] {
		return Object.values(this.all()).filter((d) => d.tier === tier);
	}
	value(d: Pick<SecretDraft, 'tier' | 'folder' | 'name'>): string {
		return this.all()[keyOf(d)]?.value ?? '';
	}
	isOpen(d: Pick<SecretDraft, 'tier' | 'folder' | 'name'>): boolean {
		return this.open().has(keyOf(d));
	}
	edit(d: Pick<SecretDraft, 'tier' | 'folder' | 'name'>): void {
		this.open.update((s) => new Set(s).add(keyOf(d)));
	}
	set(d: SecretDraft): void {
		const key = keyOf(d);
		this.all.update((a) => {
			const next = { ...a };
			if (d.value) next[key] = d;
			else delete next[key];
			return next;
		});
	}
	undo(d: Pick<SecretDraft, 'tier' | 'folder' | 'name'>): void {
		const key = keyOf(d);
		this.all.update((a) => Object.fromEntries(Object.entries(a).filter(([k]) => k !== key)));
		this.open.update((s) => new Set([...s].filter((k) => k !== key)));
	}
	/** Drops every draft of a tier, or of one folder of it (after that folder saved). */
	drop(tier: SecretTier, folder?: string): void {
		const gone = (k: string) => k.startsWith(`${tier}|${folder === undefined ? '' : `${folder}|`}`);
		this.all.update((a) => Object.fromEntries(Object.entries(a).filter(([k]) => !gone(k))));
		this.open.update((s) => new Set([...s].filter((k) => !gone(k))));
	}
	clear(): void {
		this.all.set({});
		this.open.set(new Set());
	}
}
