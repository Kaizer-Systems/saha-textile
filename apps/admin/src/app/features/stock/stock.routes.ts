import { Routes } from '@angular/router';

import { Approvals } from './approvals';
import { Held } from './held';
import { Reorder } from './reorder';
import { Reports } from './reports';
import { StockItem } from './stock-item';
import { StockList } from './stock-list';

/** Stock (i01–i06): all stock, one item's history and cost layers, held stock, approvals. */
export default [
	{ path: '', component: StockList },
	{ path: 'items/:id', component: StockItem },
	{ path: 'held', component: Held },
	{ path: 'approvals', component: Approvals },
	{ path: 'reorder', component: Reorder },
	{ path: 'reports', component: Reports },
	{ path: 'movements', component: Reports, data: { tab: 'movements' } },
] as Routes;
