/**
 * NEXT-GEN-UI · TypeDoc gateway control
 * What: adds a persistent return action to TypeDoc's native toolbar.
 * Why: generated child navigation must return to its canonical Docusaurus bridge.
 * How: mount one dependency-free anchor into TypeDoc's documented toolbar slot.
 * Tuning knobs: label variants and adapter.css toolbar breakpoint styles.
 */
const toolbarLinks = document.querySelector('#tsd-toolbar-links');

if (toolbarLinks && !toolbarLinks.querySelector('.portal-typedoc-gateway')) {
	const gateway = document.createElement('a');
	gateway.className = 'portal-typedoc-gateway';
	gateway.href = '/tools/typedoc';
	gateway.setAttribute('aria-label', 'Return to the TypeDoc gateway');

	const longLabel = document.createElement('span');
	longLabel.className = 'portal-typedoc-gateway__long';
	longLabel.textContent = 'Return to gateway';

	const shortLabel = document.createElement('span');
	shortLabel.className = 'portal-typedoc-gateway__short';
	shortLabel.setAttribute('aria-hidden', 'true');
	shortLabel.textContent = 'Gateway';

	gateway.append(longLabel, shortLabel);
	toolbarLinks.append(gateway);
}
