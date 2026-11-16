import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { adjustmentNeedsApproval } from '@saha-textile/core-domain/purchasing';
import { Subject, catchError, debounceTime, firstValueFrom, of, switchMap } from 'rxjs';

import { RupeesPipe, StockQuantityPipe, apiProblem, requestKey } from '@core/purchasing/purchasing-format';
import { StockGateway } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { FmPicker, type FmPicked } from '@features/media/file-manager/fm-picker';
import { parseQuantity } from '@features/purchasing/shared/variant-grid';

import type {
	AdjustmentPreview,
	AdjustmentResult,
	HoldReason,
	InventoryReasonCode,
	StockAdjustmentWrite,
	StockListRow,
} from '@saha-textile/contracts';

export type AdjustAction = StockAdjustmentWrite['action'];

/** Reasons Adjust offers per action (the fixed list; photoshoot and display are holds now). */
export const ADJUST_REASONS: Readonly<Record<'remove' | 'add', readonly InventoryReasonCode[]>> = {
	remove: [
		'damage',
		'lost_missing',
		'manual_recount_correction',
		'supplier_shortage',
		'internal_use_sample',
		'other',
	],
	add: ['manual_recount_correction', 'system_migration_correction', 'other'],
};
export const HOLD_REASONS: readonly HoldReason[] = [
	'waiting_for_supplier',
	'photoshoot',
	'store_display',
	'quality_check',
];

/** What a write-off or addition needs before it can be sent (P12: every write-off has a note). */
export function adjustProblem(input: {
	action: AdjustAction;
	units: number | null;
	reason: InventoryReasonCode | null;
	holdReason: HoldReason | null;
	holdId: string | null;
	note: string;
}): string | null {
	if (!input.units || input.units <= 0) return 'qty_required';
	if ((input.action === 'remove' || input.action === 'add') && !input.reason) return 'adjust_pick_reason';
	if (input.action === 'hold' && !input.holdReason) return 'adjust_pick_hold_reason';
	if (input.action === 'release' && !input.holdId) return 'adjust_pick_hold';
	if ((input.action === 'remove' || input.reason === 'other') && input.note.trim().length < 3)
		return 'adjust_note_required';
	return null;
}

/**
 * Adjust stock (i04, i04b): take out, add, move to held, release from held. Write-offs and
 * additions by someone without Approve write-offs become a request and stock waits (P2); with it
 * they apply at once, recorded as approved by them. Holds and releases never wait.
 */
@Component({
	selector: 'app-adjust-popup',
	templateUrl: './adjust-popup.html',
	imports: [FormsModule, RupeesPipe, StockQuantityPipe, TranslocoModule],
})
export class AdjustPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly modals = inject(NgbModal);
	private readonly gateway = inject(StockGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);
	private readonly destroyRef = inject(DestroyRef);

	readonly row = signal<StockListRow | null>(null);
	readonly action = signal<AdjustAction>('remove');
	readonly quantity = signal('');
	readonly reason = signal<InventoryReasonCode | null>('damage');
	readonly holdReason = signal<HoldReason | null>('waiting_for_supplier');
	readonly holdId = signal<string | null>(null);
	readonly holds = signal<Array<{ id: string; quantity: number; reason: HoldReason; note: string; since: string }>>(
		[],
	);
	readonly note = signal('');
	readonly photos = signal<FmPicked[]>([]);
	readonly preview = signal<AdjustmentPreview | null>(null);
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);
	readonly holdReasons = HOLD_REASONS;
	private readonly key = requestKey('adjust');
	private readonly changes = new Subject<StockAdjustmentWrite | null>();

	readonly canApprove = computed(() => this.auth.permissions().includes('stock.approve'));
	readonly actions = computed<AdjustAction[]>(() => {
		const has = (code: string) => this.auth.permissions().includes(code);
		const writes = has('stock.adjust') || has('stock.approve');
		return [
			...(writes ? (['remove', 'add'] as const) : []),
			...(has('stock.hold') ? (['hold', 'release'] as const) : []),
		];
	});
	readonly reasons = computed(() => {
		const action = this.action();
		return action === 'remove' || action === 'add' ? ADJUST_REASONS[action] : [];
	});
	readonly units = computed(() => {
		const row = this.row();
		if (!row) return null;
		const parsed = parseQuantity(this.quantity(), row.soldBy);
		return parsed && 'units' in parsed ? parsed.units : null;
	});
	readonly needsApproval = computed(() => adjustmentNeedsApproval(this.action(), this.canApprove()));
	readonly problem = computed(() =>
		adjustProblem({
			action: this.action(),
			units: this.units(),
			reason: this.reason(),
			holdReason: this.holdReason(),
			holdId: this.holdId(),
			note: this.note(),
		}),
	);

	constructor() {
		this.changes
			.pipe(
				debounceTime(300),
				switchMap((body) => (body ? this.gateway.preview(body).pipe(catchError(() => of(null))) : of(null))),
				takeUntilDestroyed(this.destroyRef),
			)
			.subscribe((preview) => this.preview.set(preview));
	}

	async start(row: StockListRow, preset: { action?: AdjustAction; holdId?: string } = {}): Promise<void> {
		this.row.set(row);
		const first = this.actions()[0];
		this.setAction(preset.action ?? first ?? 'remove');
		if (preset.holdId) this.holdId.set(preset.holdId);
		try {
			this.holds.set(await firstValueFrom(this.gateway.holdsOf(row.variantId)));
		} catch {
			this.holds.set([]);
		}
		if (preset.holdId) {
			const hold = this.holds().find((item) => item.id === preset.holdId);
			if (hold)
				this.quantity.set(row.soldBy === 'metre' ? (hold.quantity / 10).toFixed(1) : String(hold.quantity));
		}
		this.changed();
	}

	setAction(action: AdjustAction): void {
		this.action.set(action);
		const list = action === 'remove' || action === 'add' ? ADJUST_REASONS[action] : [];
		if (!list.includes(this.reason() ?? ('' as InventoryReasonCode))) this.reason.set(list[0] ?? null);
		if (action !== 'release' && action !== 'remove') this.holdId.set(null);
		this.changed();
	}

	body(): StockAdjustmentWrite | null {
		const row = this.row();
		const units = this.units();
		if (!row || !units) return null;
		const action = this.action();
		return {
			variantId: row.variantId,
			action,
			quantity: units,
			reasonCode: action === 'remove' || action === 'add' ? this.reason() : null,
			holdReason: action === 'hold' ? this.holdReason() : null,
			holdId: action === 'release' || action === 'remove' ? this.holdId() : null,
			note: this.note().trim(),
			photoAssetIds: this.photos().map((photo) => photo.assetId),
			requestKey: this.key,
		};
	}

	changed(): void {
		this.error.set(null);
		this.changes.next(this.problem() === 'adjust_note_required' || !this.problem() ? this.body() : null);
	}

	async addPhotos(): Promise<void> {
		const popup = this.modals.open(FmPicker, {
			size: 'xl',
			windowClass: 'theme-modal media-modal fm-picker',
			scrollable: true,
		});
		(popup.componentInstance as FmPicker).start({
			title: 'adjust_photos_pick',
			accept: 'image',
			max: 6,
			already: this.photos().length,
			profile: null,
		});
		const picked = (await popup.result.catch(() => null)) as FmPicked[] | null;
		if (picked?.length) this.photos.update((list) => [...list, ...picked].slice(0, 6));
	}

	/** The button says what happens (i04b): "Ask for approval", "Write off 2 now", "Move 1 to held"… */
	buttonKey(): string {
		const action = this.action();
		if ((action === 'remove' || action === 'add') && this.needsApproval()) return 'ask_for_approval';
		return `adjust_do_${action}`;
	}

	async save(): Promise<void> {
		const body = this.body();
		if (!body || this.problem() || this.busy() || this.preview()?.refusal) return;
		this.busy.set(true);
		this.error.set(null);
		try {
			const result: AdjustmentResult = await firstValueFrom(this.gateway.adjust(body));
			this.modal.close(result);
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}
