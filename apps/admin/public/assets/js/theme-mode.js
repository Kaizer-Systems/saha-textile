/*
 * Dark mode before the admin starts, so a dark choice never flashes light.
 *
 * Runs from <head>, before <body> exists and before Angular loads. With dark chosen in this
 * browser it links the dark stylesheet (render-blocking where the browser supports it), paints the
 * page background dark until that file arrives, and marks <body> the moment the parser creates it.
 * Kept in step with src/app/core/brand/theme-mode.ts (the same key, file and class; a unit test
 * checks), which takes over once the app runs.
 */
(function () {
	var mode = null;
	try {
		mode = window.localStorage.getItem('st_admin_theme');
	} catch (refused) {
		return;
	}
	if (mode !== 'dark') return;

	var root = document.documentElement;
	// The theme's dark page colour, until the stylesheet that sets it has loaded.
	root.style.backgroundColor = '#0b141d';
	var link = document.createElement('link');
	link.id = 'theme-dark';
	link.rel = 'stylesheet';
	link.href = '/assets/css/theme-dark.gen.css';
	link.setAttribute('blocking', 'render');
	link.onload = link.onerror = function () {
		root.style.removeProperty('background-color');
	};
	document.head.appendChild(link);

	var mark = function () {
		if (!document.body) return false;
		document.body.classList.add('dark-only');
		return true;
	};
	if (mark()) return;
	// Mutation callbacks run before the browser next draws, so <body> is dark from its first paint.
	var observer = new MutationObserver(function () {
		if (mark()) observer.disconnect();
	});
	observer.observe(root, { childList: true });
})();
