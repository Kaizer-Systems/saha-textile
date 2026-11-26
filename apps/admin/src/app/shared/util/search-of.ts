import { Params } from '@data-access/interfaces/core.interface';

/** A list page's search box text, from its table's params; none when it holds something other than text. */
export function searchOf(params: Params): string | undefined {
	const search = params['search'];
	return typeof search === 'string' ? search : undefined;
}
