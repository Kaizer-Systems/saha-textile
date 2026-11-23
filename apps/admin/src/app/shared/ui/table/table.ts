import { DatePipe, isPlatformBrowser } from '@angular/common';
import {
	Component,
	DOCUMENT,
	effect,
	inject,
	Injector,
	Input,
	input,
	output,
	PLATFORM_ID,
	Renderer2,
	viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import {
	NgbCalendar,
	NgbDate,
	NgbDateParserFormatter,
	NgbDropdownModule,
	NgbInputDatepicker,
	NgbRating,
	NgbRatingConfig,
} from '@ng-bootstrap/ng-bootstrap';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import { AuthStore } from '@core/state/auth.store';
import { LoaderStore } from '@core/state/loader.store';
import { Params } from '@data-access/interfaces/core.interface';
import {
	IBaseRow,
	ITableBulkAction,
	ITableClickedAction,
	ITableColumn,
	ITableConfig,
	ITablePickView,
} from '@data-access/interfaces/table.interface';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

import { ConfirmationModal } from '../modal/confirmation-modal/confirmation-modal';
import { DeleteModal } from '../modal/delete-modal/delete-modal';
import { Pagination } from '../pagination/pagination';

/** A ticked row as last seen, so it stays picked on other pages and searches. */
export interface TablePick {
	id: number | string;
	row: IBaseRow & Record<string, unknown>;
	view: ITablePickView;
	/** Why the last action could not do it; the chip turns amber. */
	problem: string | null;
	/** When it was picked, so the list shows the newest first. */
	at: number;
}

/** How many chips show before "+N more". */
const CHIP_LIMIT = 6;
const STORE_PREFIX = 'saha-textile:table-picks:';

@Component({
	selector: 'app-table',
	templateUrl: './table.html',
	styleUrls: ['./table.scss'],
	imports: [
		ReactiveFormsModule,
		NgbInputDatepicker,
		NgbRating,
		NgbDropdownModule,
		HasPermissionDirective,
		Pagination,
		DeleteModal,
		ConfirmationModal,
		DatePipe,
		TranslocoModule,
		CurrencySymbolPipe,
		DatePipe,
	],
})
export class Table {
	private document = inject<Document>(DOCUMENT);
	private renderer = inject(Renderer2);
	private calendar = inject(NgbCalendar);
	formatter = inject(NgbDateParserFormatter);

	readonly loader = inject(LoaderStore);
	private readonly injector = inject(Injector);
	private authStore = inject(AuthStore);
	private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

	private config: ITableConfig;
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	@Input() set tableConfig(config: ITableConfig) {
		this.config = config;
		this.refreshPicks();
	}
	get tableConfig(): ITableConfig {
		return this.config;
	}
	// TODO: Skipped for migration because:
	//  Your application code writes to the input. This prevents migration.
	@Input() hasCheckbox: boolean = false;
	readonly hasDuplicate = input<boolean>(false);
	readonly topbar = input<boolean>(true);
	readonly pagination = input<boolean>(true);
	readonly loading = input<boolean>(true);
	readonly dateRange = input<boolean>(false);
	/** Overrides the delete modal's "deleted permanently" text where a delete is really a soft one. */
	readonly deleteMessage = input<string>('deleted_message');
	/** What the search box looks for, as a translation key ("Name, GSTIN or city"). */
	readonly searchPlaceholder = input<string>('');
	/** Keeps the ticks for this browser tab under this name, so they survive opening a row and coming back. */
	readonly selectionKey = input<string>('');

	readonly tableChanged = output<Params>();
	readonly action = output<ITableClickedAction>();
	readonly rowClicked = output<any>();
	readonly selectedItems = output<(number | string)[]>();

	readonly DeleteModal = viewChild<DeleteModal>('deleteModal');
	readonly ConfirmationModal = viewChild<ConfirmationModal>('confirmationModal');

	public term = new FormControl();
	public rows = [30, 50, 100];
	public tableData: Params = {
		search: '',
		field: '',
		sort: '', // current Sorting Order
		page: 1, // current page number
		paginate: 30, // Display per page,
	};

	/**
	 * Row ids as the rows carry them: numbers on theme lists, text on lists the API fills (blog, products).
	 * A tick belongs to the row, not the page: it stays through search, page, sort and page-size changes.
	 */
	public selected: (number | string)[] = [];
	private picks = new Map<string, TablePick>();
	public permissions: string[] = [];

	public hoveredDate: NgbDate | null = null;
	public fromDate: NgbDate | null;
	public toDate: NgbDate | null;

	constructor() {
		const config = inject(NgbRatingConfig);

		config.max = 5; // customize default values of ratings used by this component tree
		config.readonly = true;

		this.term.valueChanges.pipe(debounceTime(400), distinctUntilChanged()).subscribe((data: string) => {
			this.onChangeTable(data, 'search');
		});
	}

	ngOnInit() {
		this.restorePicks();
		this.tableChanged.emit(this.tableData);
		effect(
			() => {
				const permissionList = this.authStore.permissions();
				// Wait until permissions have actually loaded — deciding gating on an empty
				// list would destructively wipe rowActions and never restore them.
				if (!permissionList?.length) return;
				this.permissions = permissionList;
				const permissions = this.tableConfig?.rowActions
					?.map((action) => action?.permission)
					.filter((item) => item != undefined);
				if (permissions?.length && !permissions.some((action) => this.permissions?.includes(<any>action))) {
					this.tableConfig['rowActions'] = [];
				}
				if (!this.hasPermission(['delete']) && !this.hasDuplicate() && !this.permittedBulk().length) {
					this.hasCheckbox = false;
				}
			},
			{ injector: this.injector },
		);
	}

	hasPermission(actions?: string[]) {
		let permission = this.tableConfig?.rowActions?.find((action) =>
			actions?.includes(action.actionToPerform),
		)?.permission;
		if (!Array.isArray(permission) && this.permissions?.includes(permission!)) {
			return true;
		} else {
			return false;
		}
	}

	onChangeTable(data: ITableColumn | any, type: string) {
		if (type === 'sort' && data && data.sortable !== false) {
			switch (data.sort_direction) {
				case 'asc':
					data.sort_direction = 'desc';
					break;
				case 'desc':
					data.sort_direction = 'asc';
					break;
				default:
					data.sort_direction = 'desc';
					break;
			}
			this.tableData['field'] = data.dataField!;
			this.tableData['sort'] = this.tableData['sort'] === 'desc' ? 'asc' : 'desc';
		} else if (type === 'paginate') {
			this.tableData['paginate'] = (<HTMLInputElement>data.target)?.value;
		} else if (type === 'page') {
			this.tableData['page'] = data;
		} else if (type === 'search') {
			this.tableData['search'] = data;
			// New filter → always restart at page 1 so server skip/limit matches the new result set.
			this.tableData['page'] = 1;
		} else if (type === 'daterange') {
			if (data?.start_date && data?.end_date && !String(data.end_date).includes('undefined')) {
				this.tableData['start_date'] = data.start_date;
				this.tableData['end_date'] = data.end_date;
			} else {
				delete this.tableData['start_date'];
				delete this.tableData['end_date'];
				// Incomplete range (only from-date picked) — do not emit yet.
				if (data?.start_date && !data?.end_date) return;
			}
		}
		this.renderer.addClass(this.document.body, 'loader-none');
		this.tableChanged.emit(this.tableData);
	}

	onActionClicked(actionType: string, rowData: any, value?: number) {
		this.renderer.addClass(this.document.body, 'loader-none');
		if (this.hasPermission([actionType])) {
			rowData[actionType] = value;
			this.action.emit({ actionToPerform: actionType, data: rowData });
		} else {
			rowData[actionType] = value;
			this.action.emit({ actionToPerform: actionType, data: rowData });
		}
	}

	onRowClicked(rowData: any): void {
		if (this.hasPermission(['edit', 'view'])) {
			this.rowClicked.emit(rowData);
		}
	}

	/** The header box ticks or unticks the rows on this page only; picks on other pages stay. */
	checkUncheckAll(event: Event) {
		const checked = Boolean((<HTMLInputElement>event?.target)?.checked);
		this.tableConfig?.data!.forEach((item: any) => {
			if (item.system_reserve != '1') {
				item.isChecked = checked;
				this.setSelectedItem(checked, item?.id);
			}
		});
	}

	/** A checkbox's value is always text, so the row it belongs to supplies the id in its own type. */
	onItemChecked(event: Event) {
		const target = <HTMLInputElement>event.target;
		const value = target?.value;
		const row = this.tableConfig?.data?.find((item) => String(item.id) === value);
		this.setSelectedItem(target?.checked, row?.id ?? value);
	}

	setSelectedItem(checked: boolean, value: number | string | undefined) {
		if (value === undefined) return;
		const key = String(value);
		if (checked) {
			if (!this.picks.has(key)) {
				const row = (this.tableConfig?.data?.find((item) => String(item.id) === key) ?? {
					id: value,
				}) as TablePick['row'];
				this.picks.set(key, { id: row.id, row, view: this.viewOf(row), problem: null, at: Date.now() });
			}
		} else {
			this.picks.delete(key);
		}
		this.afterPicksChanged();
	}

	/** Whether this row is ticked. */
	isPicked(row: IBaseRow | null | undefined): boolean {
		return !!row && this.picks.has(String(row.id));
	}

	/** The rows on this page that can be ticked. */
	private pageRows(): IBaseRow[] {
		return (this.tableConfig?.data ?? []).filter(
			(row) => (row as unknown as Record<string, unknown>)['system_reserve'] !== '1',
		);
	}

	/** How many ticked rows are on this page. */
	get pickedOnPage(): number {
		return this.pageRows().filter((row) => this.isPicked(row)).length;
	}

	/** The header box: every tickable row on this page ticked. */
	get allOnPage(): boolean {
		const rows = this.pageRows();
		return rows.length > 0 && rows.every((row) => this.isPicked(row));
	}

	/** The header box shows "–" when only some rows on this page are ticked. */
	get someOnPage(): boolean {
		const count = this.pickedOnPage;
		return count > 0 && !this.allOnPage;
	}

	/** Every pick, newest first. */
	get pickList(): TablePick[] {
		return [...this.picks.values()].sort((a, b) => b.at - a.at);
	}

	/** The chips shown above the table; the rest fold into "+N more". */
	get chips(): TablePick[] {
		return this.pickList.slice(0, CHIP_LIMIT);
	}

	get chipOverflow(): number {
		return Math.max(0, this.picks.size - CHIP_LIMIT);
	}

	/** The picks' statuses counted, for the foot of the picked list. */
	get pickCounts(): { status: string; count: number }[] {
		const counts = new Map<string, number>();
		for (const pick of this.picks.values()) {
			if (pick.view.status) counts.set(pick.view.status, (counts.get(pick.view.status) ?? 0) + 1);
		}
		return [...counts].map(([status, count]) => ({ status, count }));
	}

	/** The ticked rows as last seen, in the order they were ticked. */
	pickedRows<T extends IBaseRow = IBaseRow>(ids?: readonly (number | string)[]): T[] {
		const wanted = ids ? new Set(ids.map(String)) : null;
		return [...this.picks.values()]
			.sort((a, b) => a.at - b.at)
			.filter((pick) => !wanted || wanted.has(String(pick.id)))
			.map((pick) => pick.row as unknown as T);
	}

	/** ✕ on a chip or a list row. */
	unpick(id: number | string) {
		this.setSelectedItem(false, id);
	}

	/** Clear: every pick goes, on every page. */
	clearPicks() {
		this.picks.clear();
		this.afterPicksChanged();
	}

	/** Drops the rows an action finished with; the rest stay ticked. */
	dropPicks(ids: readonly (number | string)[]) {
		for (const id of ids) this.picks.delete(String(id));
		this.afterPicksChanged();
	}

	/** Marks the picks an action could not do, with why; the chip turns amber until it is tried again. */
	markPicks(problems: ReadonlyMap<string, string>) {
		for (const pick of this.picks.values()) pick.problem = problems.get(String(pick.id)) ?? null;
		this.persistPicks();
	}

	/** A chip or a list name opens its row, as clicking the row does. */
	openPick(pick: TablePick) {
		this.onRowClicked(pick.row);
	}

	private viewOf(row: TablePick['row']): ITablePickView {
		const fromConfig = this.tableConfig?.pickView?.(row as never);
		if (fromConfig) return fromConfig;
		const text = (value: unknown) => (typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim() : '');
		return { title: text(row['name']) || text(row['title']) || String(row.id) };
	}

	/** Rows on the page refresh their picks, so a status change shows at once. */
	private refreshPicks() {
		if (!this.picks.size) return;
		let changed = false;
		for (const row of this.config?.data ?? []) {
			const pick = this.picks.get(String(row.id));
			if (pick) {
				pick.row = row as TablePick['row'];
				pick.view = this.viewOf(pick.row);
				changed = true;
			}
		}
		if (changed) this.persistPicks();
	}

	private afterPicksChanged() {
		this.selected = [...this.picks.values()].map((pick) => pick.id);
		this.persistPicks();
		this.selectedItems.emit(this.selected);
	}

	private storeKey(): string | null {
		const key = this.selectionKey();
		return key && this.isBrowser ? `${STORE_PREFIX}${key}` : null;
	}

	private persistPicks() {
		const key = this.storeKey();
		if (!key) return;
		try {
			if (this.picks.size) sessionStorage.setItem(key, JSON.stringify([...this.picks.values()]));
			else sessionStorage.removeItem(key);
		} catch {
			// Storage can be full or blocked; the ticks still work for this visit.
		}
	}

	private restorePicks() {
		const key = this.storeKey();
		if (!key) return;
		try {
			const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]');
			if (!Array.isArray(saved)) return;
			for (const item of saved as Partial<TablePick>[]) {
				if (item?.id === undefined || !item.row || !item.view?.title) continue;
				this.picks.set(String(item.id), {
					id: item.id,
					row: item.row,
					view: item.view,
					problem: typeof item.problem === 'string' ? item.problem : null,
					at: Number(item.at) || 0,
				});
			}
			this.selected = [...this.picks.values()].map((pick) => pick.id);
			this.refreshPicks();
		} catch {
			// A damaged entry starts the list empty.
		}
	}

	/** The bulk buttons this operator may use. */
	private permittedBulk(): ITableBulkAction[] {
		return (this.tableConfig?.bulkActions ?? []).filter(
			(action) => !action.permission || this.permissions?.includes(action.permission),
		);
	}

	/** More picks than one action takes. */
	get overLimit(): boolean {
		const max = this.tableConfig?.maxPicks;
		return !!max && this.selected.length > max;
	}

	/** The table's own Delete, while anything is ticked and the operator holds the right. */
	get deleteButtonStatus() {
		if (!this.selected.length || this.tableConfig?.bulkDelete === false) return false;
		const permission = this.tableConfig?.rowActions?.find((action) => action.actionToPerform == 'delete')
			?.permission as string;
		return !!permission && !!this.permissions?.includes(permission);
	}

	/** The bulk buttons the operator may use, while anything is ticked on any page. */
	get visibleBulkActions() {
		if (!this.selected.length) return [];
		return this.permittedBulk();
	}

	/** The bulk buttons drawn in the bar. */
	get barActions(): ITableBulkAction[] {
		return this.visibleBulkActions.filter((action) => !action.more);
	}

	/** The bulk buttons under "More". */
	get moreActions(): ITableBulkAction[] {
		return this.visibleBulkActions.filter((action) => action.more);
	}

	/** A bulk button: the page's own question, or the table's confirmation. */
	runBulk(action: ITableBulkAction) {
		if (this.overLimit) return;
		const ids = this.selected.slice();
		if (action.direct) this.action.emit({ actionToPerform: action.actionToPerform, data: ids });
		else void this.ConfirmationModal()?.openModal(action.actionToPerform, ids);
	}

	/** The table's own Delete and Duplicate end with the picks they took. */
	onDeleteConfirmed(event: ITableClickedAction) {
		this.onActionClicked(String(event?.actionToPerform), event?.data);
		if (event?.actionToPerform === 'deleteAll' && Array.isArray(event.data)) this.dropPicks(event.data);
	}

	get duplicateButtonStatus() {
		if (!this.selected.length) return false;
		const permission = this.tableConfig?.rowActions?.find((action) => action.actionToPerform == 'edit')
			?.permission as string;
		return !!permission && !!this.permissions?.includes(permission);
	}

	// For Date Picker

	onDateSelection(date: NgbDate) {
		if (!this.fromDate && !this.toDate) {
			this.fromDate = date;
		} else if (this.fromDate && !this.toDate && date && date.after(this.fromDate)) {
			this.toDate = date;
		} else {
			this.toDate = null;
			this.fromDate = date;
		}

		let params = {
			start_date: `${this.fromDate.year}-${this.fromDate.month}-${this.fromDate.day}`,
			end_date: `${this.toDate?.year}-${this.toDate?.month}-${this.toDate?.day}`,
		};
		this.onChangeTable(params, 'daterange');
	}

	isHovered(date: NgbDate) {
		return (
			this.fromDate &&
			!this.toDate &&
			this.hoveredDate &&
			date.after(this.fromDate) &&
			date.before(this.hoveredDate)
		);
	}

	isInside(date: NgbDate) {
		return this.toDate && date.after(this.fromDate) && date.before(this.toDate);
	}

	isRange(date: NgbDate) {
		return (
			date.equals(this.fromDate) ||
			(this.toDate && date.equals(this.toDate)) ||
			this.isInside(date) ||
			this.isHovered(date)
		);
	}

	validateInput(currentValue: NgbDate | null, input: string): NgbDate | null {
		const parsed = this.formatter.parse(input);
		return parsed && this.calendar.isValid(NgbDate.from(parsed)) ? NgbDate.from(parsed) : currentValue;
	}

	ngOnDestroy() {
		this.renderer.removeClass(this.document.body, 'loader-none');
	}

	clearDateRange() {
		this.fromDate = null;
		this.toDate = null;
		let params = null;
		this.onChangeTable(params, 'daterange');
	}
}
