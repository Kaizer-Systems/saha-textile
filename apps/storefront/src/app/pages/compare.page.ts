// AnalogJS file-based route. Thin wrapper: the real component lives under
// features/ (ported verbatim). File path = URL; see route map in app notes.

import { ScrollPositionGuard } from '@core/guards/scroll.guard';
import { Compare } from '@features/shop/compare/compare';

export const routeMeta = { canActivate: [ScrollPositionGuard] };

export default Compare;
