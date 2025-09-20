import { state } from './state.js';
import { clearChildren, createElement } from './utils.js';

const COMMON_TAGS = ['client', 'prospect', 'partner', 'vendor', 'vip', 'enterprise', 'marketing', 'tech', 'legal', 'design', 'sales', 'support'];

let inputElement;
let suggestionsElement;
let tagsElement;
let filtersElement;
let onFiltersChanged = () => {};

export function setupTagManager({ input, suggestions, tags, filters }, onFilterChange) {
    inputElement = input;
    suggestionsElement = suggestions;
    tagsElement = tags;
    filtersElement = filters;
    onFiltersChanged = onFilterChange;

    inputElement.addEventListener('keydown', handleInputKeyDown);
    inputElement.addEventListener('input', handleInputChange);
    inputElement.addEventListener('blur', handleInputBlur);
    suggestionsElement.addEventListener('mousedown', handleSuggestionClick);
    tagsElement.addEventListener('click', handleTagClick);
    if (filtersElement) {
        filtersElement.addEventListener('click', handleFilterClick);
    }

    renderCurrentTags();
    renderTagFilters();
}


export function renderCurrentTags() {
    if (!tagsElement) return;

    clearChildren(tagsElement);

    if (!state.currentContactTags.length) {
        tagsElement.appendChild(createElement('div', {
            className: 'empty-tags',
            text: 'No tags added'
        }));
        return;
    }

    state.currentContactTags.forEach((tag, index) => {
        const wrapper = createElement('div', { className: 'tag-editable' });

        const tagElement = createElement('span', {
            className: `tag ${tag.toLowerCase()}`,
            text: tag
        });
        const removeButton = createElement('button', {
            className: 'tag-remove',
            text: '×',
            attributes: { type: 'button', 'aria-label': `Remove ${tag}` }
        });
        removeButton.dataset.removeIndex = String(index);

        wrapper.appendChild(tagElement);
        wrapper.appendChild(removeButton);
        tagsElement.appendChild(wrapper);
    });
}

export function renderTagFilters() {
    if (!filtersElement) return;

    clearChildren(filtersElement);
    const allTags = getAllTags();
    if (!allTags.length) {
        return;
    }

    filtersElement.appendChild(createElement('div', {
        className: 'filter-label',
        text: 'Filter by tags:'
    }));

    allTags.forEach(tag => {
        const displayLabel = tag.charAt(0).toUpperCase() + tag.slice(1);
        const filter = createElement('span', {
            className: `filter-tag ${state.activeTagFilters.includes(tag) ? 'active' : ''}`,
            text: displayLabel
        });
        filter.dataset.filterTag = tag;
        filtersElement.appendChild(filter);
    });

    if (state.activeTagFilters.length > 0) {
        const clearButton = createElement('button', {
            className: 'clear-filters',
            text: 'Clear All',
            attributes: { type: 'button' }
        });
        clearButton.dataset.action = 'clear-tag-filters';
        filtersElement.appendChild(clearButton);
    }
}

export function resetTagInput() {
    if (!inputElement) return;
    inputElement.value = '';
    hideSuggestions();
    renderCurrentTags();
}

function handleInputKeyDown(event) {
    if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        const value = inputElement.value.trim();
        if (value) {
            addTag(value);
            inputElement.value = '';
            hideSuggestions();
        }
    }
}

function handleInputChange() {
    const value = inputElement.value.toLowerCase().trim();
    if (value) {
        showSuggestions(value);
    } else {
        hideSuggestions();
    }
}

function handleInputBlur() {
    setTimeout(() => hideSuggestions(), 150);
}

function handleSuggestionClick(event) {
    const target = event.target.closest('[data-suggested-tag]');
    if (!target) {
        return;
    }
    event.preventDefault();
    const tag = target.dataset.suggestedTag;
    addTag(tag);
    inputElement.value = '';
    hideSuggestions();
}

function handleTagClick(event) {
    const removeButton = event.target.closest('[data-remove-index]');
    if (!removeButton) {
        return;
    }
    const index = Number(removeButton.dataset.removeIndex);
    if (!Number.isNaN(index)) {
        state.currentContactTags.splice(index, 1);
        renderCurrentTags();
    }
}

function handleFilterClick(event) {
    const clearButton = event.target.closest('[data-action="clear-tag-filters"]');
    if (clearButton) {
        state.activeTagFilters = [];
        onFiltersChanged();
        renderTagFilters();
        return;
    }

    const filterTagElement = event.target.closest('[data-filter-tag]');
    if (!filterTagElement) {
        return;
    }

    const { filterTag } = filterTagElement.dataset;
    const index = state.activeTagFilters.indexOf(filterTag);
    if (index === -1) {
        state.activeTagFilters.push(filterTag);
    } else {
        state.activeTagFilters.splice(index, 1);
    }
    onFiltersChanged();
    renderTagFilters();
}

function getAllTags() {
    const allTags = new Set();
    state.contacts.forEach(contact => {
        (contact.tags || []).forEach(tag => allTags.add(tag.toLowerCase()));
    });
    return Array.from(allTags).sort();
}

function addTag(tagName) {
    if (!tagName) return;
    const normalizedTag = tagName.toLowerCase().trim();
    if (!normalizedTag) return;

    const alreadyExists = state.currentContactTags.some(tag => tag.toLowerCase() === normalizedTag);
    if (alreadyExists) {
        return;
    }

    const formatted = normalizedTag.charAt(0).toUpperCase() + normalizedTag.slice(1);
    state.currentContactTags.push(formatted);
    renderCurrentTags();
}

function showSuggestions(input) {
    if (!suggestionsElement) return;

    const allTags = getAllTags();
    const matchingTags = allTags.filter(tag => tag.includes(input));
    const additionalSuggestions = COMMON_TAGS.filter(tag =>
        tag.includes(input) &&
        !matchingTags.includes(tag) &&
        !state.currentContactTags.some(existing => existing.toLowerCase() === tag)
    );

    const suggestions = [...matchingTags, ...additionalSuggestions]
        .filter(tag => !state.currentContactTags.some(existing => existing.toLowerCase() === tag))
        .slice(0, 5);

    clearChildren(suggestionsElement);

    if (!suggestions.length) {
        hideSuggestions();
        return;
    }

    suggestions.forEach(tag => {
        const suggestion = createElement('div', {
            className: 'tag-suggestion'
        });
        suggestion.dataset.suggestedTag = tag;

        const tagLabel = createElement('span', {
            className: `tag ${tag}`,
            text: tag
        });
        suggestion.appendChild(tagLabel);
        suggestion.appendChild(createElement('span', { text: 'Add tag' }));
        suggestionsElement.appendChild(suggestion);
    });

    suggestionsElement.style.display = 'block';
}

function hideSuggestions() {
    if (!suggestionsElement) return;
    suggestionsElement.style.display = 'none';
    clearChildren(suggestionsElement);
}
