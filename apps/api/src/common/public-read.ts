const PUBLIC_READ = /^\/(catalog|storefront\/(banners|youtube))(\/|\?|$)/;
const LIMITED = /^\/catalog\/search(\/|\?|$)/;

/** A cacheable storefront read that the shared per-address limit must not count. */
export function isPublicRead(method: string, url: string): boolean {
	return (method === 'GET' || method === 'HEAD') && PUBLIC_READ.test(url) && !LIMITED.test(url);
}
