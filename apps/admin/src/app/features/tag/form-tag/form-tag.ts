import { Component, DOCUMENT, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { BLOG_GO_LIVE_WORDS, gapsFromError, goLiveToast } from '@core/catalog/go-live-report';
import { ActiveLanguages } from '@core/i18n/active-languages';
import { focusField, gapsByLocale, type LanguageGap, LocalizedFields } from '@core/i18n/localized-fields';
import { ITag } from '@data-access/interfaces/tag.interface';
import { injectTagQuery } from '@data-access/queries/tag.queries';
import { BlogService } from '@data-access/services/blog.service';
import { NotificationService } from '@data-access/services/notification.service';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';

const LANGUAGE_FIELDS = ['name', 'description'];

/** An address from an English name. */
const slugFrom = (name: string): string =>
	name
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

@Component({
	selector: 'app-form-tag',
	templateUrl: './form-tag.html',
	styleUrls: ['./form-tag.scss'],
	imports: [ReactiveFormsModule, FormFields, LanguageSwitch, Button, TranslocoModule],
})
export class FormTag {
	private router = inject(Router);
	private route = inject(ActivatedRoute);
	private formBuilder = inject(FormBuilder);
	private blogs = inject(BlogService);
	private queryClient = inject(QueryClient);
	private notifier = inject(NotificationService);
	private transloco = inject(TranslocoService);
	private page = inject<Document>(DOCUMENT);

	readonly type = input<string>(undefined);
	readonly tagType = input<string | null>('product');

	public form: FormGroup;
	public tag: ITag | null;

	readonly locales = inject(ActiveLanguages).list();
	readonly fields: LocalizedFields;
	readonly gaps = signal<Record<string, LanguageGap[]>>({});

	private readonly tagId = signal<number | string | undefined>(undefined);
	readonly tagQuery = injectTagQuery(
		() => this.tagId(),
		() => this.tagType(),
	);

	constructor() {
		this.form = this.formBuilder.group({
			name: new FormControl('', [Validators.required]),
			description: new FormControl(),
			slug: new FormControl('', [Validators.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)]),
			type: new FormControl(this.tagType(), []),
			status: new FormControl(true),
		});
		this.fields = new LocalizedFields(this.form, LANGUAGE_FIELDS, ['description']);

		// Patch the form once the tag (by id) resolves.
		effect(() => {
			const tag = this.tagQuery.data();
			if (!tag) return;
			this.tag = tag;
			this.form.patchValue({
				name: tag.name,
				description: tag.description,
				slug: tag.slug,
				status: tag.status === true || tag.status === '1',
			});
			if (tag.blog) {
				this.fields.load({ name: tag.blog.name, description: tag.blog.description });
				this.refreshMissing();
			}
		});
	}

	ngOnChanges() {
		this.form.controls['type'].setValue(this.tagType());
	}

	ngOnInit() {
		this.route.params.subscribe((params) => {
			if (params['id']) this.tagId.set(this.isBlog() ? String(params['id']) : Number(params['id']));
		});
		this.refreshMissing();
	}

	isBlog(): boolean {
		return this.tagType() === 'post';
	}

	switchLanguage(locale: string) {
		this.fields.switchTo(locale);
		this.refreshMissing();
	}

	openLanguageGap({ key, locale }: { key: string; locale: string }) {
		this.switchLanguage(locale);
		focusField(this.page, key);
	}

	private refreshMissing() {
		this.gaps.set(gapsByLocale(this.locales, (locale) => this.fields.gaps(locale)));
	}

	submit() {
		this.form.markAllAsTouched();
		if (!this.isBlog()) {
			// The theme's product tags have no backend yet.
			if (this.form.valid) void this.router.navigateByUrl('/tag');
			return;
		}
		const name = this.fields.text('name');
		if (!name['en']?.trim()) {
			this.switchLanguage('en');
			this.form.get('name')?.setErrors({ required: true });
			return;
		}
		if (this.form.controls['slug'].invalid) return;
		const raw = this.form.getRawValue() as Record<string, unknown>;
		const slug = typeof raw['slug'] === 'string' && raw['slug'].trim() ? raw['slug'].trim() : slugFrom(name['en']);
		const body = {
			name,
			description: this.fields.text('description'),
			slug,
			status: raw['status'] ? ('live' as const) : ('draft' as const),
		};
		const id = this.tag?.blog?.id ?? null;
		this.blogs.saveTerm('tags', id, body).subscribe({
			next: () => {
				void this.queryClient.invalidateQueries({ queryKey: ['tags'] });
				void this.queryClient.invalidateQueries({ queryKey: ['tag'] });
				this.notifier.showSuccess(this.transloco.translate('saved'));
				void this.router.navigateByUrl('/blog/tag');
			},
			error: (error: unknown) => {
				const gaps = gapsFromError(error);
				if (!gaps.length) {
					this.notifier.showError(this.transloco.translate('blog_rejected'));
					return;
				}
				goLiveToast(
					{ live: false, gaps },
					this.notifier,
					(key) => this.transloco.translate(key),
					BLOG_GO_LIVE_WORDS,
				);
				const locale = gaps.find((gap) => gap.locale)?.locale;
				if (locale) this.switchLanguage(locale);
			},
		});
	}
}
