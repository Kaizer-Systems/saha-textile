import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { injectBrandQuery } from '@core/brand/brand.gateway';
import { MediaProfilesGateway, type MediaProfileWrite } from '@core/media-profiles/media-profiles.gateway';
import { MEDIA_PROFILES_QUERY_KEY, injectMediaProfileQuery } from '@data-access/queries/media-profiles.queries';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { PluralPipe } from '@shared/pipes/language.pipes';

import { IMAGE_TYPES, MB, fillKey, isIconProfile, profileNameKey } from '../profile-words';

import type { MediaFill, MediaProfile } from '@saha-textile/contracts';

type Fill = Exclude<MediaFill, 'as_is'>;

/** A photo shown in each fill card, so the four previews differ the way the real versions will. */
export const FILL_SAMPLE = 'assets/images/sign-in-saree-basket-1280.webp';
/** The family a new profile makes: one, of its own, named after the profile when it is saved. */
const NEW_FAMILY = 'own';

/**
 * Settings › Image profiles › Add or Edit (media step 2c, Media brief F02). Edits apply to versions made from now
 * on; versions already made never change. Built only from existing pieces (DEC-UI-REUSE): the theme form rows,
 * `fm-chip` size chips, the `fm-fit-demo` fill cards from the Media brief, switches and the page wrapper.
 */
@Component({
	selector: 'app-image-profile-form',
	templateUrl: './image-profile-form.html',
	imports: [PageWrapper, ReactiveFormsModule, RouterLink, TranslocoModule, PluralPipe],
})
export class ImageProfileForm {
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly gateway = inject(MediaProfilesGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly brand = injectBrandQuery();

	readonly key = signal<string | null>(this.route.snapshot.paramMap.get('key'));
	private readonly query = injectMediaProfileQuery(this.key);
	readonly profile = computed<MediaProfile | null>(() => this.query.data()?.profile ?? null);
	readonly photos = computed(() => this.query.data()?.photos ?? 0);
	readonly builtIn = computed(() => this.profile()?.builtIn === true);
	readonly icon = computed(() => !!this.profile() && isIconProfile(this.profile() as MediaProfile));
	readonly sample = FILL_SAMPLE;
	readonly types = IMAGE_TYPES;

	readonly form = new FormGroup({
		name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(60)] }),
		shapeWidth: new FormControl<number | null>(3, [Validators.min(1), Validators.max(100)]),
		shapeHeight: new FormControl<number | null>(4, [Validators.min(1), Validators.max(100)]),
		keepShape: new FormControl(false, { nonNullable: true }),
		quality: new FormControl<number | null>(null, [Validators.min(40), Validators.max(100)]),
		minPx: new FormControl<number | null>(null, [Validators.min(1), Validators.max(8192)]),
		minEdge: new FormControl<'width' | 'short'>('width', { nonNullable: true }),
		minMode: new FormControl<'warn' | 'refuse'>('warn', { nonNullable: true }),
		maxMb: new FormControl(25, {
			nonNullable: true,
			validators: [Validators.required, Validators.min(1), Validators.max(25)],
		}),
		enabled: new FormControl(true, { nonNullable: true }),
	});
	/** Sizes per family (F02 “Sizes made”); a new profile has one family. */
	readonly widths = signal<Record<string, number[]>>({ [NEW_FAMILY]: [480, 960, 1440, 1920] });
	readonly adding = signal<Record<string, string>>({});
	readonly fills = signal<Set<Fill>>(new Set(['crop', 'blur']));
	readonly accepts = signal<Set<string>>(new Set(['image/jpeg', 'image/png']));
	readonly keepShape = signal(false);
	readonly error = signal<string | null>(null);
	readonly saving = signal(false);
	/** Moves on every form change, so the fill previews follow the shape being typed. */
	private readonly changes = signal(0);

	readonly families = computed(() => Object.keys(this.widths()));
	readonly fillOptions = computed<Fill[]>(() =>
		this.icon() ? ['white', 'brand'] : ['white', 'blur', 'colour', 'crop'],
	);
	readonly brandColour = computed(() => this.brand.data()?.themeColor ?? '#417394');
	/** The fill cards are drawn at the profile's own shape. */
	readonly ratio = computed(() => {
		this.changes();
		const { shapeWidth, shapeHeight } = this.form.getRawValue();
		return shapeWidth && shapeHeight ? `${shapeWidth} / ${shapeHeight}` : '21 / 9';
	});

	constructor() {
		this.form.valueChanges.subscribe(() => this.changes.update((n) => n + 1));
		this.form.controls.keepShape.valueChanges.subscribe((keep) => {
			this.keepShape.set(keep);
			for (const control of [this.form.controls.shapeWidth, this.form.controls.shapeHeight]) {
				if (keep) control.disable({ emitEvent: false });
				else control.enable({ emitEvent: false });
			}
		});
		effect(() => {
			const profile = this.profile();
			if (!profile) return;
			this.form.reset({
				name: profile.name,
				shapeWidth: profile.shape?.width ?? null,
				shapeHeight: profile.shape?.height ?? null,
				keepShape: !profile.shape,
				quality: profile.quality,
				minPx: profile.minSize?.px ?? null,
				minEdge: profile.minSize?.edge ?? 'width',
				minMode: profile.minSize?.mode ?? 'warn',
				maxMb: Math.round(profile.maxBytes / MB),
				enabled: profile.enabled,
			});
			if (profile.builtIn) this.form.controls.name.disable();
			this.keepShape.set(!profile.shape);
			this.widths.set(structuredClone(profile.widths));
			this.fills.set(new Set(profile.fills as Fill[]));
			this.accepts.set(new Set(profile.accepts));
		});
	}

	familyKey(role: string): string {
		return role === NEW_FAMILY || role === this.key() ? 'profile_family_own' : `profile_family_${role}`;
	}

	title(): string {
		const profile = this.profile();
		if (!profile) return this.key() ? 'profile_edit' : 'profile_add';
		return 'profile_edit';
	}

	displayName(): string {
		const profile = this.profile();
		if (!profile) return '';
		return profile.builtIn ? this.transloco.translate(profileNameKey(profile)) : profile.name;
	}

	fillName(fill: Fill): string {
		return fillKey(fill, this.icon());
	}

	removeSize(role: string, width: number) {
		const list = this.widths()[role] ?? [];
		if (list.length <= 1) return;
		this.widths.update((all) => ({ ...all, [role]: list.filter((value) => value !== width) }));
	}

	setAdding(role: string, value: string) {
		this.adding.update((all) => ({ ...all, [role]: value }));
	}

	addSize(role: string) {
		const value = Number(this.adding()[role]);
		const list = this.widths()[role] ?? [];
		if (!Number.isInteger(value) || value < 16 || value > 8192 || list.includes(value) || list.length >= 12) {
			this.error.set(this.transloco.translate('profile_size_invalid'));
			return;
		}
		this.error.set(null);
		this.widths.update((all) => ({ ...all, [role]: [...list, value].sort((a, b) => a - b) }));
		this.setAdding(role, '');
	}

	toggleFill(fill: Fill) {
		this.fills.update((set) => {
			const next = new Set(set);
			if (next.has(fill)) next.delete(fill);
			else next.add(fill);
			return next;
		});
	}

	toggleType(mime: string) {
		this.accepts.update((set) => {
			const next = new Set(set);
			if (next.has(mime)) next.delete(mime);
			else next.add(mime);
			return next;
		});
	}

	private write(): MediaProfileWrite {
		const value = this.form.getRawValue();
		const keep = value.keepShape;
		return {
			name: value.name.trim(),
			shape:
				keep || !value.shapeWidth || !value.shapeHeight
					? null
					: { width: value.shapeWidth, height: value.shapeHeight },
			widths: this.widths(),
			quality: value.quality === null || `${value.quality}` === '' ? null : Number(value.quality),
			minSize: value.minPx ? { px: Number(value.minPx), edge: value.minEdge, mode: value.minMode } : null,
			fills: keep ? [] : this.fillOptions().filter((fill) => this.fills().has(fill)),
			maxBytes: Number(value.maxMb) * MB,
			accepts: this.types.map((type) => type.mime).filter((mime) => this.accepts().has(mime)),
			enabled: value.enabled,
		};
	}

	async save() {
		this.form.markAllAsTouched();
		if (this.form.invalid || this.accepts().size === 0) {
			this.error.set(this.transloco.translate('profile_form_invalid'));
			return;
		}
		this.saving.set(true);
		this.error.set(null);
		try {
			const key = this.key();
			const body = this.write();
			if (key) {
				const { name, ...rest } = body;
				await lastValueFrom(this.gateway.update(key, this.builtIn() ? rest : { name, ...rest }));
			} else {
				await lastValueFrom(this.gateway.create(body));
			}
			this.notifier.showSuccess(this.transloco.translate('profile_saved'));
			await this.queryClient.invalidateQueries({ queryKey: MEDIA_PROFILES_QUERY_KEY });
			void this.router.navigate(['/setting/image-profiles']);
		} catch (error) {
			const code =
				error instanceof HttpErrorResponse
					? (error.error as { issues?: { code?: string }[] } | null)?.issues?.[0]?.code
					: undefined;
			this.error.set(this.transloco.translate(code ? `profile_error_${code}` : 'profile_error_unknown'));
		} finally {
			this.saving.set(false);
		}
	}
}
