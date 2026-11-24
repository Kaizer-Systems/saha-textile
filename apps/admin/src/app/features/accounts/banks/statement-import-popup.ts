import { Component, Injectable, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

import { parseCsv } from '@features/purchasing/shared/sheet-rows';

import type { BankAccountRow, BankLayout } from '@saha-textile/contracts';

/** A statement file as read in the popup, carried to the page that matches its columns and checks its lines. */
export interface StatementRead {
	bankAccountId: string;
	fileName: string;
	rows: string[][];
	/** The saved layout picked, or null to match the columns (BA5). */
	layoutId: string | null;
}

/** Holds the file read in BA4 until BA6 saves it; nothing reaches the server before then. */
@Injectable({ providedIn: 'root' })
export class StatementImportState {
	readonly read = signal<StatementRead | null>(null);
}

/** What the bank page hands the popup. */
export interface StatementImportStart {
	accounts: readonly BankAccountRow[];
	bankAccountId: string;
	layouts: readonly BankLayout[];
}

/**
 * Import a bank statement (accounts brief BA4): into which account, the file from net banking, and the bank's saved
 * layout (or match the columns once). The file is read here, in the browser; PDF statements wait for text recognition.
 */
@Component({
	selector: 'app-statement-import-popup',
	templateUrl: './statement-import-popup.html',
	imports: [TranslocoModule, FormsModule],
})
export class StatementImportPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly router = inject(Router);
	private readonly state = inject(StatementImportState);

	readonly accounts = signal<readonly BankAccountRow[]>([]);
	readonly layouts = signal<readonly BankLayout[]>([]);
	readonly into = signal('');
	readonly layoutId = signal('');
	readonly fileName = signal('');
	readonly rows = signal<string[][]>([]);
	readonly problem = signal<string | null>(null);

	readonly ready = computed(() => !!this.into() && this.rows().length > 0);

	start(start: StatementImportStart): void {
		this.accounts.set(start.accounts);
		this.layouts.set(start.layouts);
		this.into.set(start.bankAccountId);
		this.layoutId.set(start.layouts[0]?.id ?? '');
	}

	/** Reads the CSV in the browser; Excel is saved as CSV first until a reader for it is added. */
	async read(file: File | null | undefined): Promise<void> {
		if (!file) return;
		this.fileName.set(file.name);
		this.rows.set([]);
		this.problem.set(null);
		if (!/\.(csv|txt|tsv)$/i.test(file.name)) {
			this.problem.set('import_csv_only');
			return;
		}
		const rows = parseCsv(await file.text());
		if (!rows.length) this.problem.set('bank_import_empty');
		else this.rows.set(rows);
	}

	/** On to matching the columns (a new layout) or straight to checking the lines (a saved one). */
	go(): void {
		if (!this.ready()) return;
		this.state.read.set({
			bankAccountId: this.into(),
			fileName: this.fileName(),
			rows: this.rows(),
			layoutId: this.layoutId() || null,
		});
		this.modal.close(true);
		void this.router.navigate(['/accounts/banks', this.into(), 'import']);
	}
}
