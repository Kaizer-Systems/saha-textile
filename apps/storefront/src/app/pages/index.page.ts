// AnalogJS file-based route. `index.page.ts` maps to `/` — the app's default home.
// Thin wrapper over the custom Home component (built from theme widgets).

import { ScrollPositionGuard } from '@core/guards/scroll.guard';
import { Home } from '@features/home/home';

export const routeMeta = {
	canActivate: [ScrollPositionGuard],
};

export default Home;
