import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { AttachmentService } from '@data-access/services/attachment.service';

export function injectAttachmentsQuery(params: () => Params) {
	const attachmentService = inject(AttachmentService);
	return injectQuery(() => ({
		queryKey: ['attachments', params()],
		queryFn: () => firstValueFrom(attachmentService.getAttachments(params())),
	}));
}
