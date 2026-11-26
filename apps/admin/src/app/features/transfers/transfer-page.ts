import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { money } from '@core/orders/order-format';
import { apiProblem, openPdf, shortDate } from '@core/purchasing/purchasing-format';
import { TRANSFER_KEYS, TransfersGateway, transferProblemKey } from '@core/transfers/transfers.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { FmPicker, type FmPicked } from '@features/media/file-manager/fm-picker';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { quantityText, TRANSFER_PILL, TRANSFER_STEPS } from './transfer-format';

import type { TransferLine, TransferView } from '@saha-textile/contracts';

interface Count {
	arrived: number;
	damaged: number;
	note: string;
}

/**
 * A transfer (accounts brief N4): its steps, pieces, documents and what moved. At the sender it is approved or
 * rejected, then packed on the stock-out checklist (N5: tick or scan every piece, seal number, boxes, a photo, the
 * vehicle, the e-way bill above the threshold; Dispatch stays off until all are packed). At the receiver it is counted
 * on the stock-in checklist (N6: what arrived, what is damaged; a short piece becomes a carrier claim or a loss).
 */
@Component({
	selector: 'app-transfer-page',
	imports: [PageWrapper, TranslocoModule, FormsModule],
	templateUrl: './transfer-page.html',
})
export class TransferPage {
	private readonly gateway = inject(TransfersGateway);
	private readonly route = inject(ActivatedRoute);
	private readonly modals = inject(NgbModal);
	private readonly queries = inject(QueryClient);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);

	readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
	readonly transfer = injectQuery(() => ({
		queryKey: TRANSFER_KEYS.one(this.id()),
		queryFn: () => firstValueFrom(this.gateway.one(this.id())),
		enabled: !!this.id(),
	}));
	readonly pill = TRANSFER_PILL;
	readonly steps = TRANSFER_STEPS;

	readonly reason = signal('');
	/** Which reason box is open: rejecting the request or cancelling it. */
	readonly asking = signal<'reject' | 'cancel' | null>(null);
	readonly busy = signal(false);
	readonly problem = signal<{ key: string; params: Record<string, string> } | null>(null);

	/** The checklists hold only what was changed here; the rest is what was saved. */
	readonly packedEdits = signal<Record<string, number>>({});
	readonly scanCode = signal('');
	readonly sealEdit = signal<string | null>(null);
	readonly boxesEdit = signal<number | null | undefined>(undefined);
	readonly photos = signal<FmPicked[]>([]);
	readonly vehicleEdit = signal<string | null>(null);
	readonly ewayEdit = signal<string | null>(null);
	readonly countEdits = signal<Record<string, Count>>({});
	readonly short = signal<'carrier_claim' | 'transit_loss'>('carrier_claim');

	packedOf(line: TransferLine): number {
		return this.packedEdits()[line.lineId] ?? line.packed;
	}

	sealOf(t: TransferView): string {
		return this.sealEdit() ?? t.sealNumber;
	}

	vehicleOf(t: TransferView): string {
		return this.vehicleEdit() ?? t.vehicle;
	}

	ewayOf(t: TransferView): string {
		return this.ewayEdit() ?? t.ewayBillNumber ?? '';
	}

	boxesOf(t: TransferView): number | null {
		const edit = this.boxesEdit();
		return edit === undefined ? t.boxes : edit;
	}

	/** N6: what arrived starts as everything sent, none of it damaged. */
	countOf(line: TransferLine): Count {
		return this.countEdits()[line.lineId] ?? { arrived: line.quantity, damaged: 0, note: '' };
	}

	/** N5's checks, each met or not. */
	readonly checks = computed(() => {
		const t = this.transfer.data();
		if (!t) return [];
		const done = t.lines.reduce((sum, l) => sum + this.packedOf(l), 0);
		const needed = t.lines.reduce((sum, l) => sum + l.quantity, 0);
		const ewayNeeded = t.estimatedValueINR >= t.ewayBillFromINR;
		return [
			{ key: 'tr_check_packed', ok: done === needed, params: { done: String(done), of: String(needed) } },
			{ key: 'tr_check_seal', ok: !!this.sealOf(t).trim(), params: {} },
			{
				key: ewayNeeded ? 'tr_check_eway' : 'tr_check_eway_not_needed',
				ok: !ewayNeeded || /^(\d{12}|\d{14})$/.test(this.ewayOf(t).trim()),
				params: { from: this.rupees(t.ewayBillFromINR) },
			},
		];
	});
	readonly canDispatch = computed(() => !this.busy() && !!this.checks().length && this.checks().every((c) => c.ok));
	/** N6: what is short and what is damaged, each needing its reason before it can be received. */
	readonly shortPieces = computed(() =>
		(this.transfer.data()?.lines ?? []).reduce((sum, l) => sum + l.quantity - this.countOf(l).arrived, 0),
	);
	readonly damagedPieces = computed(() =>
		(this.transfer.data()?.lines ?? []).reduce((sum, l) => sum + this.countOf(l).damaged, 0),
	);

	rupees(amount: number): string {
		return money(amount, 'INR');
	}

	date(value: string | null): string {
		return shortDate(value);
	}

	text(quantity: number | null, soldBy: 'piece' | 'metre'): string {
		return quantity === null ? '—' : quantityText(quantity, soldBy);
	}

	/** A step's date and who, once it happened. */
	stepAt(t: TransferView, status: string): string | null {
		const step = t.timeline.find((s) => s.status === status);
		return step ? shortDate(step.at) : null;
	}

	private async act(work: () => Promise<unknown>, done: string): Promise<void> {
		this.busy.set(true);
		this.problem.set(null);
		try {
			await work();
			this.asking.set(null);
			this.reason.set('');
			this.notifier.showSuccess(this.transloco.translate(done));
			await this.queries.invalidateQueries({ queryKey: TRANSFER_KEYS.all });
		} catch (error) {
			this.problem.set(transferProblemKey(apiProblem(error, 'cash_failed')));
		} finally {
			this.busy.set(false);
		}
	}

	approve(t: TransferView): Promise<void> {
		return this.act(
			() => firstValueFrom(this.gateway.decide(t.id, { approve: true, reason: '', version: t.version })),
			'tr_done_approved',
		);
	}

	reject(t: TransferView): Promise<void> {
		return this.act(
			() =>
				firstValueFrom(
					this.gateway.decide(t.id, { approve: false, reason: this.reason().trim(), version: t.version }),
				),
			'tr_done_rejected',
		);
	}

	cancel(t: TransferView): Promise<void> {
		return this.act(
			() => firstValueFrom(this.gateway.cancel(t.id, { reason: this.reason().trim(), version: t.version })),
			'tr_done_cancelled',
		);
	}

	setPacked(lineId: string, value: number, most: number): void {
		const n = Math.max(0, Math.min(most, Math.floor(Number(value) || 0)));
		this.packedEdits.update((all) => ({ ...all, [lineId]: n }));
	}

	/** A scanned SKU ticks one more piece (or metre) of its line. */
	scan(t: TransferView): void {
		const code = this.scanCode().trim().toUpperCase();
		const line = t.lines.find((l) => l.sku.toUpperCase() === code);
		this.scanCode.set('');
		if (!line) {
			this.problem.set({ key: 'counter_problem_counter_code_unknown', params: {} });
			return;
		}
		this.problem.set(null);
		this.setPacked(line.lineId, this.packedOf(line) + (line.soldBy === 'metre' ? 10 : 1), line.quantity);
	}

	async addPhoto(): Promise<void> {
		const popup = this.modals.open(FmPicker, {
			size: 'xl',
			windowClass: 'theme-modal media-modal fm-picker',
			scrollable: true,
		});
		(popup.componentInstance as FmPicker).start({
			title: 'tr_photo',
			accept: 'image',
			max: 10,
			already: this.photos().length,
			profile: null,
		});
		const picked = (await popup.result.catch(() => null)) as FmPicked[] | null;
		if (picked?.length)
			this.photos.update((list) => [
				...list,
				...picked.filter((p) => !list.some((a) => a.assetId === p.assetId)),
			]);
	}

	/** Save the checklist as it is, or dispatch it. */
	pack(t: TransferView, dispatch: boolean): Promise<void> {
		return this.act(
			() =>
				firstValueFrom(
					this.gateway.pack(t.id, {
						lines: t.lines.map((l) => ({ lineId: l.lineId, packed: this.packedOf(l) })),
						sealNumber: this.sealOf(t).trim(),
						boxes: this.boxesOf(t),
						photoAssetIds: [...t.photoAssetIds, ...this.photos().map((p) => p.assetId)],
						vehicle: this.vehicleOf(t).trim(),
						ewayBillNumber: this.ewayOf(t).trim(),
						version: t.version,
						dispatch,
					}),
				),
			dispatch ? 'tr_done_dispatched' : 'tr_done_saved',
		);
	}

	setCount(line: TransferLine, field: 'arrived' | 'damaged', value: number): void {
		const current = this.countOf(line);
		const most = field === 'arrived' ? line.quantity : current.arrived;
		const n = Math.max(0, Math.min(most, Math.floor(Number(value) || 0)));
		const next = { ...current, [field]: n };
		next.damaged = Math.min(next.damaged, next.arrived);
		this.countEdits.update((all) => ({ ...all, [line.lineId]: next }));
	}

	setNote(line: TransferLine, note: string): void {
		this.countEdits.update((all) => ({ ...all, [line.lineId]: { ...this.countOf(line), note } }));
	}

	receive(t: TransferView): Promise<void> {
		return this.act(
			() =>
				firstValueFrom(
					this.gateway.receive(t.id, {
						lines: t.lines.map((l) => ({ lineId: l.lineId, ...this.countOf(l) })),
						short: this.short(),
						version: t.version,
					}),
				),
			'tr_done_received',
		);
	}

	async print(t: TransferView): Promise<void> {
		try {
			openPdf(await firstValueFrom(this.gateway.print(t.id)));
		} catch (error) {
			this.problem.set(transferProblemKey(apiProblem(error, 'cash_failed')));
		}
	}
}
