const state = {
	payload: undefined,
	selectedCollection: undefined,
	query: '',
};

const list = document.querySelector('#model-list');
const detail = document.querySelector('#model-detail');
const counts = document.querySelector('#catalogue-counts');
const search = document.querySelector('#catalogue-search');

function element(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (typeof text === 'string') node.textContent = text;
	return node;
}

function stringify(value) {
	return typeof value === 'undefined' ? '—' : JSON.stringify(value);
}

function matches(model) {
	if (!state.query) return true;
	const haystack = [
		model.collection,
		model.model,
		model.context,
		model.purpose,
		...model.fields.flatMap((field) => [field.path, field.type, field.elementType ?? '', ...field.enum]),
	].join(' ');
	return haystack.toLocaleLowerCase('en').includes(state.query);
}

function renderList() {
	const visible = state.payload.models.filter(matches);
	list.replaceChildren();
	for (const model of visible) {
		const button = element('button', 'model-button');
		button.type = 'button';
		button.dataset.active = model.collection === state.selectedCollection ? 'true' : 'false';
		button.append(
			element('span', 'model-button__context', model.context),
			element('strong', '', model.collection),
			element('span', '', `${model.fields.length} fields · ${model.indexes.length} indexes`),
		);
		button.addEventListener('click', () => {
			state.selectedCollection = model.collection;
			render();
		});
		list.append(button);
	}
	if (visible.length === 0) {
		list.append(element('p', 'empty-state', 'No current model matches this search.'));
	}
	if (!visible.some((model) => model.collection === state.selectedCollection)) {
		state.selectedCollection = visible[0]?.collection;
	}
}

function renderFields(model, target) {
	const section = element('section', 'catalogue-panel');
	section.append(element('h2', '', 'Fields'));
	const tableWrap = element('div', 'table-wrap');
	const table = element('table');
	const head = element('thead');
	const headRow = element('tr');
	for (const label of ['Path', 'BSON shape', 'Required', 'Default', 'Enum / policy']) {
		headRow.append(element('th', '', label));
	}
	head.append(headRow);
	const body = element('tbody');
	for (const field of model.fields) {
		const row = element('tr');
		if (field.temporaryShape) row.dataset.temporary = 'true';
		const type = field.elementType ? `${field.type}<${field.elementType}>` : field.type;
		const policies = [
			field.enum.length > 0 ? `enum: ${field.enum.join(', ')}` : '',
			field.select === 'excluded-by-default' ? 'excluded by default' : '',
			field.sensitive ? 'sensitive' : '',
			field.temporaryShape ? 'temporary shape' : '',
		]
			.filter(Boolean)
			.join(' · ');
		row.append(
			element('td', 'field-path', field.path),
			element('td', '', type),
			element('td', '', field.required ? 'yes' : 'no'),
			element('td', '', stringify(field.default)),
			element('td', 'field-policy', policies || '—'),
		);
		body.append(row);
	}
	table.append(head, body);
	tableWrap.append(table);
	section.append(tableWrap);
	target.append(section);
}

function renderIndexes(model, target) {
	const section = element('section', 'catalogue-panel');
	section.append(element('h2', '', 'Indexes'));
	if (model.indexes.length === 0) {
		section.append(element('p', 'empty-state', 'No explicit indexes.'));
	} else {
		const grid = element('div', 'index-grid');
		for (const index of model.indexes) {
			const card = element('article', 'index-card');
			card.append(
				element('code', '', stringify(index.keys)),
				element('span', '', Object.keys(index.options).length ? stringify(index.options) : 'standard'),
			);
			grid.append(card);
		}
		section.append(grid);
	}
	target.append(section);
}

function renderDetail() {
	const model = state.payload.models.find((item) => item.collection === state.selectedCollection);
	detail.replaceChildren();
	if (!model) {
		detail.append(element('p', 'empty-state', 'Choose a model constellation.'));
		return;
	}

	const header = element('header', 'model-heading');
	const identity = element('div');
	identity.append(
		element('p', 'eyebrow', `${model.context} · ${model.status}`),
		element('h2', '', model.collection),
		element('p', '', model.purpose),
	);
	const source = element('code', 'source-path', model.source);
	header.append(identity, source);
	detail.append(header);

	if (model.limitations.length > 0) {
		const warning = element('section', 'limitation-panel');
		warning.append(element('strong', '', 'Temporary shapes detected'));
		for (const limitation of model.limitations) warning.append(element('span', '', limitation));
		detail.append(warning);
	}

	renderFields(model, detail);
	renderIndexes(model, detail);

	const example = element('section', 'catalogue-panel');
	example.append(
		element('h2', '', 'Synthetic shape preview'),
		element(
			'p',
			'panel-note',
			'Generated from schema metadata. Sensitive excluded-by-default fields are omitted; no record data is used.',
		),
		element('pre', '', JSON.stringify(model.example, null, 2)),
	);
	detail.append(example);
}

function render() {
	renderList();
	renderDetail();
	const visibleCount = state.payload.models.filter(matches).length;
	counts.textContent = `${visibleCount}/${state.payload.counts.currentModels} models · ${state.payload.counts.fields} fields · ${state.payload.counts.indexes} indexes · ${state.payload.counts.temporaryShapes} temporary shapes`;
}

search.addEventListener('input', (event) => {
	state.query = event.currentTarget.value.trim().toLocaleLowerCase('en');
	render();
});

fetch('./catalogue.json')
	.then((response) => {
		if (!response.ok) throw new Error(`Catalogue request failed with ${response.status}`);
		return response.json();
	})
	.then((payload) => {
		state.payload = payload;
		state.selectedCollection = payload.models[0]?.collection;
		render();
	})
	.catch((error) => {
		detail.replaceChildren(
			element('p', 'empty-state', `The generated catalogue could not be loaded: ${error.message}`),
		);
	});
