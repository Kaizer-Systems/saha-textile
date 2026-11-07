// AnalogJS file-based route → /<locale>/collections, the general all-products page.
// Named category pages are the catch-all beside it (collections/[...category]).

import { ScrollPositionGuard } from '@core/guards/scroll.guard';
import { Collection } from '@features/shop/collection/collection';

export const routeMeta = { canActivate: [ScrollPositionGuard] };

export default Collection;
