// AnalogJS catch-all → /en/collections/<canonical_path> (named category pages, any
// depth: /en/collections/sarees, /en/collections/sarees/pure-silk/katan-banarasi …).
// Same Collection component as the base page; it reads the path param as the base
// category and filters by that node's descendants. Coexists with collections.page.ts
// (which handles the bare /en/collections).

import { ScrollPositionGuard } from '@core/guards/scroll.guard';
import { Collection } from '@features/shop/collection/collection';

export const routeMeta = { canActivate: [ScrollPositionGuard] };

export default Collection;
