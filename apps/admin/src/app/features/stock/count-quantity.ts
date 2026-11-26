import { linesQuantity, metresText } from '@features/purchasing/shared/purchasing-labels';
import { translateCount } from '@shared/pipes/language.pipes';

import type { TranslocoService } from '@jsverse/transloco';

/**
 * A count's short, over or net with pieces and metres kept apart, since they never add up (owner, 24 Nov): "4" as
 * before when only pieces differ, "1.5 m" when only fabric does, "4 pieces and 1.5 m" when both do. Fabric comes in
 * tenths of a metre.
 */
export function countQuantity(transloco: TranslocoService, pieces: number, tenths: number): string {
	const t = (key: string, params?: Record<string, unknown>) => transloco.translate(key, params);
	if (!tenths) return String(pieces);
	if (!pieces) return metresText(tenths, t);
	return linesQuantity(
		[
			{ quantity: pieces, soldBy: 'piece' },
			{ quantity: tenths, soldBy: 'metre' },
		],
		(key, n) => translateCount(transloco, key, n),
		t,
		transloco.getActiveLang(),
	);
}
