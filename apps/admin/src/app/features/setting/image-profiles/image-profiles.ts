import { HttpErrorResponse } from '@angular/common/http';
import { Component, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { formatList } from '@saha-textile/core-domain/languages';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { MediaProfilesGateway, type MediaProfileListItem } from '@core/media-profiles/media-profiles.gateway';
import { AuthStore } from '@core/state/auth.store';
import { MEDIA_PROFILES_QUERY_KEY, injectMediaProfilesQuery } from '@data-access/queries/media-profiles.queries';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { PluralPipe } from '@shared/pipes/language.pipes';
import { Button } from '@shared/ui/button/button';

import { MB, fillKey, isIconProfile, profileNameKey, shapeBox, shapeLabel, sizesLabel } from './profile-words';

/** What the confirm popup asks: delete an unused profile, or switch off one photos use (F03). */
interface Ask {
	kind: 'delete' | 'turn_off';
	row: MediaProfileListItem;
}

/**
 * Settings › Image profiles (media step 2c, Media brief F01 and F03): every profile with its shape, sizes, smallest
 * photo, fills, upload limit and how many photos use it, switched on or off in place. Built only from existing
 * pieces (DEC-UI-REUSE): the page wrapper, the theme table with the #actions icons, switches, `fm-pchip` and
 * `fm-shape` from the Media page, and the theme's confirm popup.
 */
@Component({
	selector: 'app-image-profiles-settings',
	templateUrl: './image-profiles.html',
	imports: [PageWrapper, RouterLink, TranslocoModule, HasPermissionDirective, Button, PluralPipe],
})
export class ImageProfilesSettings {
	private readonly gateway = inject(MediaProfilesGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly modal = inject(NgbModal);
	private readonly auth = inject(AuthStore);

	private readonly query = injectMediaProfilesQuery();
	readonly rows = computed(() => this.query.data() ?? []);
	readonly loading = computed(() => this.query.isPending());
	readonly canEdit = computed(() => this.auth.permissions().includes('setting.edit'));
	readonly ask = signal<Ask | null>(null);
	readonly confirmTemplate = viewChild<TemplateRef<unknown>>('profileConfirm');

	readonly shapeBox = shapeBox;
	readonly sizesLabel = sizesLabel;
	readonly mb = (bytes: number) => Math.round(bytes / MB);

	name(row: MediaProfileListItem): string {
		return row.profile.builtIn ? this.transloco.translate(profileNameKey(row.profile)) : row.profile.name;
	}

	shape(row: MediaProfileListItem): string {
		return shapeLabel(row.profile.shape) ?? this.transloco.translate('profile_keep_shape');
	}

	smallest(row: MediaProfileListItem): string {
		const rule = row.profile.minSize;
		if (!rule) return '—';
		return this.transloco.translate(rule.edge === 'short' ? 'profile_min_short' : 'profile_min_wide', {
			px: rule.px,
		});
	}

	fills(row: MediaProfileListItem): string {
		const { profile } = row;
		if (!profile.shape) return this.transloco.translate('profile_keep_shape');
		const icon = isIconProfile(profile);
		const names = profile.fills.map((fill) => this.transloco.translate(fillKey(fill, icon)));
		const list = formatList(names, this.transloco.getActiveLang());
		return profile.mainPhotoOnly ? this.transloco.translate('profile_fill_fixed', { fill: list }) : list || '—';
	}

	async toggle(row: MediaProfileListItem, event: Event) {
		const input = event.target as HTMLInputElement;
		try {
			const saved = await lastValueFrom(this.gateway.update(row.profile.key, { enabled: input.checked }));
			input.checked = saved.enabled;
			this.notifier.showSuccess(
				this.transloco.translate(saved.enabled ? 'profile_switched_on' : 'profile_switched_off', {
					name: this.name(row),
				}),
			);
		} catch (error) {
			input.checked = row.profile.enabled;
			this.refused(error);
		}
		void this.queryClient.invalidateQueries({ queryKey: MEDIA_PROFILES_QUERY_KEY });
	}

	/** F03: a profile photos use is switched off instead of deleted; an unused one asks before it goes. */
	askDelete(row: MediaProfileListItem) {
		const template = this.confirmTemplate();
		if (!template) return;
		this.ask.set({ kind: row.photos > 0 ? 'turn_off' : 'delete', row });
		this.modal.open(template, { centered: true, windowClass: 'theme-modal text-center' }).result.then(
			() => void this.confirm(),
			() => this.ask.set(null),
		);
	}

	private async confirm() {
		const current = this.ask();
		if (!current) return;
		try {
			if (current.kind === 'turn_off') {
				await lastValueFrom(this.gateway.update(current.row.profile.key, { enabled: false }));
				this.notifier.showSuccess(
					this.transloco.translate('profile_switched_off', { name: this.name(current.row) }),
				);
			} else {
				await lastValueFrom(this.gateway.remove(current.row.profile.key));
				this.notifier.showSuccess(
					this.transloco.translate('profile_deleted', { name: this.name(current.row) }),
				);
			}
		} catch (error) {
			this.refused(error);
		}
		this.ask.set(null);
		void this.queryClient.invalidateQueries({ queryKey: MEDIA_PROFILES_QUERY_KEY });
	}

	private refused(error: unknown) {
		const code =
			error instanceof HttpErrorResponse
				? (error.error as { issues?: { code?: string }[] } | null)?.issues?.[0]?.code
				: undefined;
		this.notifier.showError(this.transloco.translate(code ? `profile_error_${code}` : 'profile_error_unknown'));
	}
}
