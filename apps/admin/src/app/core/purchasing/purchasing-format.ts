import { Pipe, inject, type PipeTransform } from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';
import { formatQuantity, formatRupees, type SoldBy } from '@saha-textile/core-domain/purchasing';

/**
 * Shared bits of the purchases and stock screens: money and quantities the way the API writes
 * them (English digits in every language, BN-3), status pills on the theme's own `status-*`
 * classes, and table cells built from escaped text only.
 */

export function escapeHtml(value: unknown): string {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** ₹1,83,750 or ₹9,295.61; a dash for nothing. */
export function rupees(value: number | null | undefined): string {
	return value === null || value === undefined ? '—' : formatRupees(value);
}

/** 7, or 42.5 m for fabric sold by the metre (stored as tenths, P11). */
export function quantity(units: number | null | undefined, soldBy: SoldBy = 'piece'): string {
	return units === null || units === undefined ? '—' : formatQuantity(units, soldBy);
}

/** Metres typed on a form → whole tenths; pieces stay whole. */
export function toUnits(typed: number, soldBy: SoldBy): number {
	return soldBy === 'metre' ? Math.round(typed * 10) : Math.round(typed);
}

/** Whole tenths → the number a metre box shows (2.5); pieces as they are. */
export function fromUnits(units: number, soldBy: SoldBy): number {
	return soldBy === 'metre' ? units / 10 : units;
}

/** `12 Nov 2026` from `2026-11-12` (or an instant), in India time. */
export function shortDate(value: string | null | undefined): string {
	if (!value) return '—';
	const date = value.length === 10 ? new Date(`${value}T12:00:00+05:30`) : new Date(value);
	if (Number.isNaN(date.getTime())) return '—';
	return date.toLocaleDateString('en-IN', {
		timeZone: 'Asia/Kolkata',
		day: 'numeric',
		month: 'short',
		year: 'numeric',
	});
}

/** `12 Nov 2026, 4:12 pm` in India time. */
export function shortDateTime(value: string | null | undefined): string {
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '—';
	const day = date.toLocaleDateString('en-IN', {
		timeZone: 'Asia/Kolkata',
		day: 'numeric',
		month: 'short',
		year: 'numeric',
	});
	const time = date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
	return `${day}, ${time.toLowerCase()}`;
}

/** A status pill on the theme's order-list classes (`status-pending`, `status-completed`…). */
export function pill(kind: string, label: string): string {
	return `<div class="status-${escapeHtml(kind)}"><span>${escapeHtml(label)}</span></div>`;
}

/** The theme pill each document state wears (the brief's screens). */
export const PILLS = {
	entry: { draft: 'draft', checked: 'processing', posted: 'completed', void: 'cancelled' },
	payment: { unpaid: 'pending', part_paid: 'processing', paid: 'completed' },
	order: {
		draft: 'draft',
		sent: 'processing',
		part_received: 'pending',
		received: 'completed',
		closed_short: 'cancelled',
		cancelled: 'cancelled',
	},
	returns: { draft: 'draft', sent: 'processing', settled: 'completed' },
	stock: { in_stock: 'in_stock', low: 'pending', out: 'out_of_stock', made_to_order: 'processing' },
	count: {
		counting: 'processing',
		review: 'pending',
		awaiting_approval: 'awaiting_for_approval',
		posted: 'completed',
		cancelled: 'cancelled',
	},
	request: { pending: 'awaiting_for_approval', approved: 'completed', applied: 'completed', rejected: 'cancelled' },
} as const;

/** An item cell: picture, name, SKU and options (the brief's line tables). Escaped throughout. */
export function itemCell(input: {
	imageUrl: string | null;
	title: string;
	sku: string;
	optionsLabel?: string | null;
	note?: string | null;
}): string {
	const image = input.imageUrl
		? `<img src="${escapeHtml(input.imageUrl)}" alt="" width="40" height="52" class="rounded" style="object-fit:cover">`
		: `<div class="user-round" style="width:40px;height:52px"><h4>${escapeHtml(input.title.charAt(0).toUpperCase() || '•')}</h4></div>`;
	const options = input.optionsLabel ? ` · ${escapeHtml(input.optionsLabel)}` : '';
	const note = input.note ? `<div class="small text-muted">${escapeHtml(input.note)}</div>` : '';
	return `<div class="d-flex align-items-center gap-2 text-start">${image}<div><h6 class="mb-0">${escapeHtml(input.title)}</h6><small class="text-muted">${escapeHtml(input.sku)}${options}</small>${note}</div></div>`;
}

/** A spreadsheet-friendly file (UTF-8 with BOM so Excel reads ₹ and Bengali right), saved by the browser. */
export function downloadCsv(
	fileName: string,
	header: readonly string[],
	rows: ReadonlyArray<ReadonlyArray<string | number | null>>,
): void {
	const cell = (value: string | number | null) => {
		const text = value === null ? '' : String(value);
		return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
	};
	const body = [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
	const blob = new Blob(['﻿', body], { type: 'text/csv;charset=utf-8' });
	saveBlob(fileName, blob);
}

export function saveBlob(fileName: string, blob: Blob): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = fileName;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** One refusal from the API: its code (translated where a screen has words for it), its sentence, and what it is about. */
export interface ApiIssue {
	code: string;
	message: string;
	/** The line, field or document the refusal names (the second part of the issue's path), or null. */
	target: string | null;
}

/**
 * Every refusal in an API error, in order. Plain network failures give an empty list. The API's
 * exception filter wraps every refusal as `{ error: { code, message, issues } }`; a bare
 * `{ issues }` body is read too.
 */
export function apiIssues(error: unknown): ApiIssue[] {
	const outer = (error as { error?: unknown } | null)?.error;
	const wrapped = outer && typeof outer === 'object' ? (outer as { error?: unknown }).error : undefined;
	const body = wrapped && typeof wrapped === 'object' ? wrapped : outer;
	if (!body || typeof body !== 'object') return [];
	const issues = (body as { issues?: unknown }).issues;
	if (!Array.isArray(issues)) {
		const message = (body as { message?: unknown }).message;
		return typeof message === 'string' && message ? [{ code: message, message, target: null }] : [];
	}
	return issues
		.filter(
			(issue): issue is { code?: unknown; message?: unknown; path?: unknown } =>
				!!issue && typeof issue === 'object',
		)
		.map((issue) => {
			const path = Array.isArray(issue.path) ? issue.path.map(String) : [];
			const code = typeof issue.code === 'string' ? issue.code : (path[0] ?? 'refused');
			return {
				code,
				message: typeof issue.message === 'string' ? issue.message : code,
				target: path.length > 1 ? (path[1] ?? null) : null,
			};
		});
}

/** The first refusal's sentence, for a toast; `fallback` when the API sent none (network, server fault). */
export function apiProblem(error: unknown, fallback: string): string {
	return apiIssues(error)[0]?.message ?? fallback;
}

/** HTTP status of a failed call (409 is "someone else saved this first"). */
export function apiStatus(error: unknown): number | null {
	const status = (error as { status?: unknown } | null)?.status;
	return typeof status === 'number' ? status : null;
}

/** A fresh key for a button that must never act twice (post, send, adjust). */
export function requestKey(prefix: string): string {
	return `${prefix}-${crypto.randomUUID()}`;
}

@Pipe({ name: 'rupees' })
export class RupeesPipe implements PipeTransform {
	transform(value: number | null | undefined): string {
		return rupees(value);
	}
}

/** 7, or "42.5 m" / "42.5 মি." in the admin's language (metres are stored as tenths, P11). */
@Pipe({ name: 'stockQty', pure: false })
export class StockQuantityPipe implements PipeTransform {
	private readonly transloco = inject(TranslocoService);

	transform(units: number | null | undefined, soldBy: SoldBy = 'piece'): string {
		if (units === null || units === undefined) return '—';
		return soldBy === 'metre'
			? this.transloco.translate('unit_metres', { value: (units / 10).toFixed(1) })
			: String(units);
	}
}

@Pipe({ name: 'shortDate' })
export class ShortDatePipe implements PipeTransform {
	transform(value: string | null | undefined): string {
		return shortDate(value);
	}
}

@Pipe({ name: 'shortDateTime' })
export class ShortDateTimePipe implements PipeTransform {
	transform(value: string | null | undefined): string {
		return shortDateTime(value);
	}
}
