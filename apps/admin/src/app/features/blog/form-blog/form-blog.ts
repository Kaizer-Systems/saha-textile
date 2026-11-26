import { DOCUMENT, isPlatformBrowser, AsyncPipe } from '@angular/common';
import { Component, PLATFORM_ID, inject, input, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Editor, NgxEditorModule } from 'ngx-editor';
import { Observable, Subject, of } from 'rxjs';
import { switchMap, takeUntil } from 'rxjs/operators';

import { BLOG_GO_LIVE_WORDS, gapsFromError, goLiveLabels, goLiveToast } from '@core/catalog/go-live-report';
import { ActiveLanguages } from '@core/i18n/active-languages';
import {
	focusField,
	gapsByLocale,
	type LanguageGap,
	LocalizedFields,
	type LocalizedText,
} from '@core/i18n/localized-fields';
import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { ICategoryModel } from '@data-access/interfaces/category.interface';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { injectTagsQuery } from '@data-access/queries/tag.queries';
import { BlogService } from '@data-access/services/blog.service';
import { NotificationService } from '@data-access/services/notification.service';
import { AdvancedDropdown } from '@shared/ui/advanced-dropdown/advanced-dropdown';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload, type PickedAttachment, ImageUploadValue, onePicture } from '@shared/ui/image-upload/image-upload';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';

import type { AdminBlogPostRow, BlogPostWrite, GoLiveGap, GoLiveResult } from '@saha-textile/contracts';

/** Every language-bound field on the form, by its control name. */
const LANGUAGE_FIELDS = [
	'title',
	'description',
	'content',
	'author',
	'cover_alt',
	'cover_title',
	'cover_caption',
	'meta_title',
	'meta_description',
];

/** Fields that may stay empty; once English is written, every language needs them. */
const OPTIONAL_FIELDS = ['description', 'author', 'cover_title', 'cover_caption', 'meta_title', 'meta_description'];

/** Where each Go Live gap is fixed on this form. */
const GAP_CONTROLS: Readonly<Record<string, string>> = {
	title: 'title',
	content: 'content',
	excerpt: 'description',
	author: 'author',
	meta_title: 'meta_title',
	meta_description: 'meta_description',
	image_alt: 'cover_alt',
	cover: 'image',
	image_sizes: 'image',
	category: 'category',
	blog_category: 'category',
	blog_tag: 'tag',
};

/** The shop's default byline in each language. */
const DEFAULT_AUTHOR: LocalizedText = { en: 'Saha Textile', bn: 'সাহা টেক্সটাইল' };

const SHOP_TIME_ZONE = 'Asia/Kolkata';

/** A stored moment as the date the shop shows, in Kolkata time: `2026-11-08`. */
export function shopDate(iso: string | null | undefined): string {
	if (!iso) return '';
	return new Intl.DateTimeFormat('en-CA', { timeZone: SHOP_TIME_ZONE }).format(new Date(iso));
}

/** A picked date as the start of that day in Kolkata. */
export function fromShopDate(date: string): string {
	return new Date(`${date}T00:00:00+05:30`).toISOString();
}

const asAttachment = (image: AdminBlogPostRow['cover']): IAttachment | null =>
	image ? ({ id: image.id, original_url: image.url } as unknown as IAttachment) : null;

/** A tile's picture with the version the post stored for it, so the tile can name it (E04). */
const withVersion = (image: IAttachment | null, versions: Readonly<Record<string, string>>): IAttachment | null =>
	image && versions[String(image.id)] ? ({ ...image, versionId: versions[String(image.id)] } as IAttachment) : image;

@Component({
	selector: 'app-form-blog',
	templateUrl: './form-blog.html',
	styleUrls: ['./form-blog.scss'],
	imports: [
		ReactiveFormsModule,
		FormFields,
		NgxEditorModule,
		ImageUpload,
		AdvancedDropdown,
		LanguageSwitch,
		Button,
		TranslocoModule,
		AsyncPipe,
	],
})
export class FormBlog {
	public row: AdminBlogPostRow | null = null;
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);
	private blogService = inject(BlogService);
	private notifier = inject(NotificationService);
	private transloco = inject(TranslocoService);
	private queryClient = inject(QueryClient);
	private page = inject<Document>(DOCUMENT);

	readonly type = input<string>(undefined);

	private readonly categoriesQuery = injectCategoriesQuery(() => ({ type: 'post' }));
	category$: Observable<ICategoryModel | undefined> = toObservable(this.categoriesQuery.data);
	readonly tagsQuery = injectTagsQuery(() => ({ type: 'post' }));

	public form: FormGroup;
	public id: string | null = null;
	public selectedCategories: string[] = [];
	public selectedTags: string[] = [];
	public cover: IAttachment | null = null;
	public shareImage: IAttachment | null = null;
	/** The version each chosen picture shows, by photo id (R4-1; media step 4d). */
	private imageVersions: Record<string, string> = {};
	public editor: Editor;
	private destroy$ = new Subject<void>();
	public isBrowser: boolean;

	readonly locales = inject(ActiveLanguages).list();
	readonly fields: LocalizedFields;
	readonly gaps = signal<Record<string, LanguageGap[]>>({});
	readonly goLiveGaps = signal<GoLiveGap[]>([]);
	/** The date shown when the post was loaded; the API keeps the stored moment unless it changes. */
	private loadedDate = '';

	constructor() {
		const platformId = inject(PLATFORM_ID);

		this.isBrowser = isPlatformBrowser(platformId);

		this.form = this.formBuilder.group({
			title: new FormControl(''),
			slug: new FormControl('', [Validators.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)]),
			description: new FormControl(''),
			content: new FormControl(''),
			author: new FormControl(''),
			cover_alt: new FormControl(''),
			cover_title: new FormControl(''),
			cover_caption: new FormControl(''),
			meta_title: new FormControl(''),
			meta_description: new FormControl(''),
			blog_meta_image_id: new FormControl<string | null>(null),
			blog_thumbnail_id: new FormControl('', [Validators.required]),
			categories: new FormControl<string[]>([], [Validators.required]),
			tags: new FormControl<string[]>([]),
			is_featured: new FormControl(false),
			is_sticky: new FormControl(false),
			published_at: new FormControl(''),
		});
		this.fields = new LocalizedFields(this.form, LANGUAGE_FIELDS, OPTIONAL_FIELDS);
		this.fields.load({ author: { ...DEFAULT_AUTHOR } });
	}

	ngOnInit() {
		this.route.params
			.pipe(
				switchMap((params) => (params['id'] ? this.blogService.getPost(params['id']) : of(null))),
				takeUntil(this.destroy$),
			)
			.subscribe((row) => {
				if (row) this.load(row);
				this.refreshMissing();
			});

		if (this.isBrowser) {
			this.editor = new Editor();
		}
	}

	private load(row: AdminBlogPostRow) {
		const { post } = row;
		this.row = row;
		this.id = post.id;
		this.selectedCategories = post.categoryIds;
		this.selectedTags = post.tagIds;
		this.imageVersions = { ...(post.imageVersions ?? {}) };
		this.cover = withVersion(asAttachment(row.cover), this.imageVersions);
		this.shareImage = withVersion(asAttachment(row.shareImage), this.imageVersions);
		this.loadedDate = shopDate(post.publishedAt);
		this.form.patchValue({
			slug: post.slug,
			blog_thumbnail_id: post.coverAssetId ?? '',
			blog_meta_image_id: post.shareImageAssetId,
			categories: post.categoryIds,
			tags: post.tagIds,
			is_featured: post.featured,
			is_sticky: post.sticky,
			published_at: this.loadedDate,
		});
		this.fields.load({
			title: post.title,
			description: post.excerpt,
			content: post.content,
			author: post.author,
			cover_alt: row.cover?.alt ?? {},
			cover_title: row.cover?.title ?? {},
			cover_caption: row.cover?.caption ?? {},
			meta_title: post.seoTitle,
			meta_description: post.seoDescription,
		});
	}

	isLive(): boolean {
		return this.row?.post.status === 'live';
	}

	switchLanguage(locale: string) {
		this.fields.switchTo(locale);
		this.refreshMissing();
	}

	openLanguageGap({ key, locale }: { key: string; locale: string }) {
		this.switchLanguage(locale);
		focusField(this.page, key);
	}

	/** A line of the Go Live alert opens the language, and the field, where the gap can be fixed. */
	openGap({ field, locale }: GoLiveGap) {
		if (locale) this.switchLanguage(locale);
		focusField(this.page, GAP_CONTROLS[field.split(':')[0] as string] ?? 'title');
	}

	gapLabels(): string[] {
		return goLiveLabels(this.goLiveGaps(), (key) => this.transloco.translate(key), BLOG_GO_LIVE_WORDS);
	}

	private refreshMissing() {
		this.gaps.set(gapsByLocale(this.locales, (locale) => this.fields.gaps(locale)));
	}

	/** Keeps the version a picture was chosen with in the Media picker (R4-1; media step 4d). */
	private keepVersion(data: IAttachment | null | undefined) {
		const versionId = (data as PickedAttachment | null | undefined)?.versionId;
		if (data && versionId) this.imageVersions = { ...this.imageVersions, [String(data.id)]: versionId };
	}

	selectThumbnail(value: ImageUploadValue) {
		const data = onePicture(value);
		if (!Array.isArray(value)) {
			this.keepVersion(data);
			this.cover = data ?? null;
			this.form.controls['blog_thumbnail_id'].setValue(data ? String(data.id) : '');
		}
	}

	selectMetaImage(value: ImageUploadValue) {
		const data = onePicture(value);
		if (!Array.isArray(value)) {
			this.keepVersion(data);
			this.shareImage = data ?? null;
			this.form.controls['blog_meta_image_id'].setValue(data ? String(data.id) : null);
		}
	}

	selectCategoryItem(data: string[]) {
		if (Array.isArray(data)) {
			this.form.controls['categories'].setValue(data.map(String));
		}
	}

	selectTagItem(data: (string | number)[]) {
		if (Array.isArray(data)) {
			this.form.controls['tags'].setValue(data.map(String));
		}
	}

	private body(): BlogPostWrite {
		const raw = this.form.getRawValue() as Record<string, unknown>;
		const text = (field: string): LocalizedText => this.fields.text(field);
		const slug = typeof raw['slug'] === 'string' && raw['slug'].trim() ? raw['slug'].trim() : undefined;
		const date = typeof raw['published_at'] === 'string' ? raw['published_at'] : '';
		const ids = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
		return {
			title: text('title'),
			...(slug ? { slug } : {}),
			excerpt: text('description'),
			content: text('content'),
			coverAssetId:
				typeof raw['blog_thumbnail_id'] === 'string' && raw['blog_thumbnail_id']
					? raw['blog_thumbnail_id']
					: null,
			coverText: { alt: text('cover_alt'), title: text('cover_title'), caption: text('cover_caption') },
			shareImageAssetId:
				typeof raw['blog_meta_image_id'] === 'string' && raw['blog_meta_image_id']
					? raw['blog_meta_image_id']
					: null,
			imageVersions: this.imageVersions,
			categoryIds: ids(raw['categories']),
			tagIds: ids(raw['tags']),
			featured: !!raw['is_featured'],
			sticky: !!raw['is_sticky'],
			author: text('author'),
			...(date !== this.loadedDate ? { publishedAt: date ? fromShopDate(date) : null } : {}),
			seoTitle: text('meta_title'),
			seoDescription: text('meta_description'),
		};
	}

	submit() {
		this.form.markAllAsTouched();
		if (!this.fields.text('title')['en']?.trim()) {
			this.switchLanguage('en');
			this.form.get('title')?.setErrors({ required: true });
			return;
		}
		if (this.form.controls['slug'].invalid) return;
		this.blogService.savePost(this.id, this.body()).subscribe({
			next: (row) => {
				void this.queryClient.invalidateQueries({ queryKey: ['blogs'] });
				this.notifier.showSuccess(this.transloco.translate('saved'));
				this.goLiveGaps.set([]);
				if (!this.id) void this.router.navigateByUrl(`/blog/edit/${row.post.id}`);
				else this.load(row);
				this.refreshMissing();
			},
			error: (error: unknown) => {
				const gaps = gapsFromError(error);
				if (gaps.length) this.report({ live: false, gaps });
				else this.notifier.showError(this.transloco.translate('blog_rejected'));
			},
		});
	}

	/** Go Live: the same call and the same toast as the blog list. Saves the form first. */
	goLive() {
		const id = this.id;
		if (!id) return;
		this.blogService
			.savePost(id, this.body())
			.pipe(switchMap(() => this.blogService.goLive(id)))
			.subscribe({
				next: (result) => {
					this.report(result);
					void this.queryClient.invalidateQueries({ queryKey: ['blogs'] });
					if (result.live) void this.router.navigateByUrl('/blog');
				},
				error: () => this.notifier.showError(this.transloco.translate('blog_rejected')),
			});
	}

	private report(result: GoLiveResult) {
		this.goLiveGaps.set(result.gaps);
		goLiveToast(result, this.notifier, (key) => this.transloco.translate(key), BLOG_GO_LIVE_WORDS);
	}

	ngOnDestroy() {
		this.editor?.destroy();
		this.destroy$.next();
		this.destroy$.complete();
	}
}
