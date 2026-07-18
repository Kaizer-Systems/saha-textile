// AnalogJS file-based route → /en/collections (KB-shaped, locale-prefixed,
// parity with /en/product/:slug). Literal `en` segment for now; a non-breaking
// rename to `[locale]` in the site-wide locale pass. The demo route at
// /collections is kept until the demo pages are dropped.

import { ScrollPositionGuard } from '@core/guards/scroll.guard';
import { Collection } from '@features/shop/collection/collection';

export const routeMeta = { canActivate: [ScrollPositionGuard] };

export default Collection;
