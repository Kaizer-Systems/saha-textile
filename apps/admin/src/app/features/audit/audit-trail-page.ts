import { Component, computed, inject, signal, type TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery, keepPreviousData } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { shortDateTime } from '@core/purchasing/purchasing-format';
import { AUDIT_KEYS, AuditGateway } from '@core/worklist/audit.gateway';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { ExportMenu, type ExportSource } from '@shared/ui/export-menu/export-menu';

import type { AuditLogEntry } from '@saha-textile/contracts';

/** The modules a record's action starts with (AU1's picker); "Other" reads the rest. */
export const AUDIT_MODULES = [
	'orders',
	'purchasing',
	'stock',
	'products',
	'accounts',
	'payroll',
	'customers',
	'admin_user',
	'role',
	'settings',
	'auth',
] as const;

/** A value as the change shows it. */
export function shown(value: unknown): string {
	if (value === undefined || value === null || value === '') return '—';
	return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** What changed, in one line: each field from → to, and the reason when one was given. */
export function changeLine(e: AuditLogEntry): string {
	const fields = e.diffs.map((d) => `${d.field}: ${shown(d.before)} → ${shown(d.after)}`);
	const reason = typeof e.metadata['reason'] === 'string' ? [`"${e.metadata['reason'] as string}"`] : [];
	return [...fields, ...reason].join(' · ');
}

/**
 * Settings › Audit trail (brief 26 AU1, approved 2026-11-26): every action the admin keeps, reviewed by module,
 * action, person and time; each row opens the change in full (every field before and after, and what else was
 * kept); the Export menu. Records are never edited or deleted here.
 */
@Component({
	selector: 'app-audit-trail-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, ExportMenu],
	templateUrl: './audit-trail-page.html',
})
export class AuditTrailPage {
	private readonly gateway = inject(AuditGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly modals = inject(NgbModal);

	readonly modules = AUDIT_MODULES;
	readonly module = signal('');
	readonly action = signal('');
	readonly actor = signal('');
	readonly from = signal('');
	readonly to = signal('');
	readonly page = signal(1);
	readonly pageSize = 50;
	readonly when = shortDateTime;
	readonly changeLine = changeLine;
	readonly shown = shown;
	readonly open = signal<AuditLogEntry | null>(null);

	readonly query = computed(() => {
		const q: Record<string, string | number> = { page: this.page(), pageSize: this.pageSize, audience: 'admin' };
		if (this.module()) q['module'] = this.module();
		if (this.action().trim()) q['action'] = this.action().trim();
		if (this.actor().trim()) q['actorUserId'] = this.actor().trim();
		if (this.from()) q['from'] = new Date(`${this.from()}T00:00:00+05:30`).toISOString();
		if (this.to()) q['to'] = new Date(`${this.to()}T23:59:59+05:30`).toISOString();
		return q;
	});
	readonly list = injectQuery(() => ({
		queryKey: AUDIT_KEYS.list(this.query()),
		queryFn: () => firstValueFrom(this.gateway.list(this.query())),
		placeholderData: keepPreviousData,
	}));
	readonly pages = computed(() => Math.max(1, Math.ceil((this.list.data()?.total ?? 0) / this.pageSize)));
	/** The Who picker: everyone by name. */
	readonly people = injectQuery(() => ({
		queryKey: ['audit', 'people'] as const,
		queryFn: () => firstValueFrom(this.gateway.people()),
	}));
	/** A record's person by name, else their id, else the system. */
	who(e: AuditLogEntry): string {
		return e.actorName ?? e.actorUserId ?? this.transloco.translate('wl_system');
	}

	/** A filter changed: back to the first page. */
	set(which: 'module' | 'action' | 'actor' | 'from' | 'to', value: string): void {
		this[which].set(value);
		this.page.set(1);
	}

	/** The module of a record: its action's first part. */
	readonly moduleOf = (e: AuditLogEntry) => {
		const dot = e.action.indexOf('.');
		return dot < 0 ? e.action : e.action.slice(0, dot);
	};

	show(template: TemplateRef<unknown>, e: AuditLogEntry): void {
		this.open.set(e);
		this.modals.open(template, { centered: true, size: 'lg' });
	}

	/**
	 * Every record the filters match, read 200 at a time (the trail's own page limit), for the export: no cap, so an
	 * export is never silently short; it stops when the total is read or a page comes back empty.
	 */
	private async everything(): Promise<AuditLogEntry[]> {
		const out: AuditLogEntry[] = [];
		for (let page = 1; ; page++) {
			const found = await firstValueFrom(this.gateway.list({ ...this.query(), page, pageSize: 200 }));
			out.push(...found.items);
			if (!found.items.length || page * 200 >= found.total) return out;
		}
	}

	readonly exportSource = async (): Promise<ExportSource> => {
		const t = (key: string) => this.transloco.translate(key);
		const all = await this.everything();
		return {
			fileName: 'audit-trail',
			title: t('atr_title'),
			filters: [
				...(this.module() ? [{ label: t('atr_module'), value: this.module() }] : []),
				...(this.from() || this.to() ? [{ label: t('atr_when'), value: `${this.from()} – ${this.to()}` }] : []),
			],
			header: [t('atr_when'), t('atr_who'), t('atr_module'), t('atr_action'), t('atr_record'), t('atr_what')],
			rows: all.map((e) => [
				e.createdAt,
				e.actorName ?? e.actorUserId ?? '',
				this.moduleOf(e),
				e.action,
				`${e.entityType ?? ''} ${e.entityId ?? ''}`.trim(),
				changeLine(e),
			]),
		};
	};
}
