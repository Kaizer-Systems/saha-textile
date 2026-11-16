import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { languageName } from '@saha-textile/core-domain/languages';
import { injectMutation, injectQueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom, type Observable } from 'rxjs';

import {
	AdminLanguagesGateway,
	type LanguageSettingsResponse,
	type LanguageTodoResponse,
} from '@core/admin-languages/admin-languages.gateway';
import { ActiveLanguages } from '@core/i18n/active-languages';
import {
	LANGUAGE_REMINDERS_QUERY_KEY,
	LANGUAGE_SETTINGS_QUERY_KEY,
	injectLanguageSettingsQuery,
} from '@data-access/queries/admin-languages.queries';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { PluralPipe } from '@shared/pipes/language.pipes';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';

import type { LanguageArea, LanguageSettingsRow, ShippedLanguage } from '@saha-textile/contracts';

/** The API's refusal codes (domain refusals), each with the sentence the page shows for it. */
const REFUSAL_KEYS: Readonly<Record<string, string>> = {
	english_fixed: 'lang_error_english_fixed',
	unknown_language: 'lang_error_unknown_language',
	already_added: 'lang_error_already_added',
	not_in_release: 'lang_error_not_in_release',
	admin_text_incomplete: 'lang_error_admin_text_incomplete',
	todo_left: 'lang_error_todo_left',
	shop_on: 'lang_error_shop_on',
	not_deleted: 'lang_error_not_deleted',
	name_mismatch: 'lang_error_name_mismatch',
	already_erased: 'lang_error_already_erased',
};

/** The list each written area opens, filtered to what is missing in the language (L4). */
export const AREA_LISTS: Readonly<Partial<Record<LanguageArea, string>>> = {
	products: '/product',
	options: '/attribute',
	categories: '/category',
	banners: '/home-banners',
	blog_posts: '/blog',
	blog_categories: '/blog/category',
	blog_tags: '/blog/tag',
	events: '/event',
	stores: '/setting/stores',
	faqs: '/faq',
	search_words: '/search-term',
	addon_templates: '/addon-template',
	pages: '/page',
	photos: '/media/files',
};

/** The popups this page opens, each with the language it is about. */
type Dialog =
	| { kind: 'add' }
	| { kind: 'todo'; row: LanguageSettingsRow; todo: LanguageTodoResponse | null }
	| { kind: 'shop_blocked'; row: LanguageSettingsRow; todo: LanguageTodoResponse | null }
	| { kind: 'shop_on'; row: LanguageSettingsRow }
	| { kind: 'shop_off'; row: LanguageSettingsRow }
	| { kind: 'delete'; row: LanguageSettingsRow }
	| { kind: 'erase'; row: LanguageSettingsRow };

/**
 * Settings › Languages (step 0d, owner decision round 2026-11-15; brief accepted with Option 1).
 *
 * Built only from existing pieces (DEC-UI-REUSE): the Stores page's wrapper, Add button, theme table,
 * switches, badges and row actions; the Communications page's theme popup with its icon box and
 * button box; Bootstrap's list group, select, alert and help text. The API decides every rule again
 * and answers the whole page after each change.
 */
@Component({
	selector: 'app-languages-settings',
	templateUrl: './languages.html',
	imports: [
		PageWrapper,
		RouterModule,
		ReactiveFormsModule,
		TranslocoModule,
		DatePipe,
		Button,
		FormFields,
		HasPermissionDirective,
		PluralPipe,
	],
})
export class LanguagesSettings {
	private readonly modalService = inject(NgbModal);
	private readonly gateway = inject(AdminLanguagesGateway);
	private readonly queryClient = injectQueryClient();
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly activeLanguages = inject(ActiveLanguages);
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);

	readonly settingsQuery = injectLanguageSettingsQuery();
	/** Languages in use, English first; deleted ones are reached from the bell's reminder. */
	readonly rows = computed(() => (this.settingsQuery.data()?.rows ?? []).filter((row) => !row.deletedAt));
	/** Languages this release ships that are not in use: what Add can offer, and what it cannot yet. */
	readonly addable = computed(() => {
		const used = new Set(this.rows().map((row) => row.code));
		return (this.settingsQuery.data()?.shipped ?? []).filter((row) => !used.has(row.code));
	});

	readonly dialogTpl = viewChild<TemplateRef<unknown>>('languageDialog');
	readonly dialog = signal<Dialog | null>(null);
	readonly saving = signal(false);
	readonly error = signal<string | null>(null);
	readonly addControl = new FormControl('', { nonNullable: true });
	readonly eraseControl = new FormControl('', { nonNullable: true });

	readonly areaLists = AREA_LISTS;
	private ref: NgbModalRef | null = null;

	private readonly changeMutation = injectMutation(() => ({
		mutationFn: (change: () => Observable<LanguageSettingsResponse>) => lastValueFrom(change()),
		onSuccess: (page: LanguageSettingsResponse) => {
			this.queryClient.setQueryData(LANGUAGE_SETTINGS_QUERY_KEY, page);
			void this.queryClient.invalidateQueries({ queryKey: LANGUAGE_REMINDERS_QUERY_KEY });
			// Forms and the header menu read the new lists at once.
			void this.activeLanguages.load();
		},
	}));

	constructor() {
		// The bell's reminder opens the erase popup for its language.
		const erase = this.route.snapshot.queryParamMap.get('erase');
		if (erase) {
			void lastValueFrom(this.gateway.settings()).then((page) => {
				const row = page.rows.find((entry) => entry.code === erase && entry.deletedAt && !entry.erasedAt);
				if (row) this.open({ kind: 'erase', row });
			});
		}
	}

	name(code: string): string {
		return languageName(code);
	}

	shipped(code: string): ShippedLanguage | undefined {
		return this.settingsQuery.data()?.shipped.find((row) => row.code === code);
	}

	openAdd(): void {
		this.addControl.setValue(this.addable().find((row) => row.inBoth)?.code ?? '');
		this.open({ kind: 'add' });
	}

	openTodo(row: LanguageSettingsRow): void {
		this.open({ kind: 'todo', row, todo: null });
		this.loadTodo(row);
	}

	add(): void {
		const code = this.addControl.value;
		if (!code) return;
		this.run(() => this.gateway.add(code), true);
	}

	onAdminToggle(row: LanguageSettingsRow, event: Event): void {
		const input = event.target;
		if (!(input instanceof HTMLInputElement)) return;
		const on = input.checked;
		// The switch shows the stored state until the server agrees.
		input.checked = row.admin;
		this.run(() => this.gateway.switchAdmin(row.code, on));
	}

	onShopToggle(row: LanguageSettingsRow, event: Event): void {
		const input = event.target;
		if (!(input instanceof HTMLInputElement)) return;
		const on = input.checked;
		input.checked = row.shop === 'on';
		if (!on) {
			this.open({ kind: 'shop_off', row });
			return;
		}
		if (row.todo > 0) {
			this.open({ kind: 'shop_blocked', row, todo: null });
			this.loadTodo(row);
			return;
		}
		this.open({ kind: 'shop_on', row });
	}

	openDelete(row: LanguageSettingsRow): void {
		if (row.shop === 'on') {
			this.notifier.showError(this.transloco.translate('lang_error_shop_on'));
			return;
		}
		this.open({ kind: 'delete', row });
	}

	/** The popup's main button. */
	confirm(): void {
		const dialog = this.dialog();
		if (!dialog || this.saving()) return;
		if (dialog.kind === 'add') return this.add();
		if (dialog.kind === 'shop_on') return this.run(() => this.gateway.switchShop(dialog.row.code, true), true);
		if (dialog.kind === 'shop_off') return this.run(() => this.gateway.switchShop(dialog.row.code, false), true);
		if (dialog.kind === 'delete') return this.run(() => this.gateway.remove(dialog.row.code), true);
		if (dialog.kind === 'erase') {
			return this.run(() => this.gateway.erase(dialog.row.code, this.eraseControl.value), true);
		}
		// The shop switch was refused: show everything that is left.
		if (dialog.kind === 'shop_blocked') this.dialog.set({ kind: 'todo', row: dialog.row, todo: dialog.todo });
		else this.ref?.close();
	}

	/** "Keep it" on the erase popup: the bell asks again in 30 days. */
	keep(): void {
		const dialog = this.dialog();
		if (dialog?.kind !== 'erase') return;
		this.run(() => this.gateway.keep(dialog.row.code), true);
	}

	cancel(): void {
		this.ref?.dismiss();
	}

	openArea(area: LanguageArea, code: string): void {
		const list = AREA_LISTS[area];
		if (!list) return;
		this.ref?.close();
		void this.router.navigate([list], { queryParams: { missing: code } });
	}

	private loadTodo(row: LanguageSettingsRow): void {
		void lastValueFrom(this.gateway.todo(row.code)).then(
			(todo) => {
				const dialog = this.dialog();
				if (
					dialog &&
					(dialog.kind === 'todo' || dialog.kind === 'shop_blocked') &&
					dialog.row.code === row.code
				) {
					this.dialog.set({ ...dialog, todo });
				}
			},
			() => this.error.set('lang_error_not_saved'),
		);
	}

	private open(dialog: Dialog): void {
		const tpl = this.dialogTpl();
		if (!tpl) return;
		this.ref?.dismiss();
		this.dialog.set(dialog);
		this.error.set(null);
		this.eraseControl.reset();
		this.ref = this.modalService.open(tpl, {
			ariaLabelledBy: 'language-dialog-title',
			centered: true,
			windowClass: 'theme-modal text-center',
		});
		const ref = this.ref;
		// Closed or dismissed, the popup ends the same way; a dismissal is not an error.
		const closed = (): void => {
			if (this.ref !== ref) return;
			this.ref = null;
			this.dialog.set(null);
		};
		ref.result.then(closed, closed);
	}

	/** Sends a change; a refusal shows in the popup when one is open, else as a toast. */
	private run(change: () => Observable<LanguageSettingsResponse>, inPopup = false): void {
		this.saving.set(true);
		this.error.set(null);
		this.changeMutation.mutate(change, {
			onSuccess: () => {
				if (inPopup) this.ref?.close();
				this.notifier.showSuccess(this.transloco.translate('saved'));
			},
			onError: (error) => {
				const key = this.refusalKey(error);
				if (inPopup && this.ref) this.error.set(key);
				else this.notifier.showError(this.transloco.translate(key));
			},
			onSettled: () => this.saving.set(false),
		});
	}

	private refusalKey(error: unknown): string {
		if (!(error instanceof HttpErrorResponse)) return 'lang_error_not_saved';
		if (error.status === 404) return 'lang_error_unknown_language';
		const code: unknown = error.error?.error?.issues?.[0]?.code;
		return (typeof code === 'string' && REFUSAL_KEYS[code]) || 'lang_error_not_saved';
	}
}
