import { state, setFilteredContacts, resetPagination } from './state.js';
import { formatDate, clearChildren, createElement } from './utils.js';

export function applyFilters(searchTerm = '') {
    const normalizedTerm = searchTerm.trim().toLowerCase();

    const filtered = state.contacts.filter(contact => {
        const matchesSearch = !normalizedTerm ||
            contact.name.toLowerCase().includes(normalizedTerm) ||
            contact.email.toLowerCase().includes(normalizedTerm) ||
            contact.phone.toLowerCase().includes(normalizedTerm) ||
            (contact.tags || []).some(tag => tag.toLowerCase().includes(normalizedTerm));

        const matchesTags = !state.activeTagFilters.length ||
            (contact.tags || []).some(tag => state.activeTagFilters.includes(tag.toLowerCase()));

        return matchesSearch && matchesTags;
    });

    setFilteredContacts(filtered);
    resetPagination();
}

export function renderContacts(container) {
    clearChildren(container);

    const startIndex = (state.currentPage - 1) * state.contactsPerPage;
    const endIndex = startIndex + state.contactsPerPage;
    const pageContacts = state.filteredContacts.slice(startIndex, endIndex);

    if (!pageContacts.length) {
        container.appendChild(createElement('div', {
            className: 'empty-state',
            html: '<h3>No contacts found</h3><p>Try adjusting your search or add a new contact.</p>'
        }));
        return;
    }

    pageContacts.forEach(contact => {
        const card = createElement('div', { className: 'contact-card', attributes: { 'data-contact-id': contact.id } });

        const header = createElement('div', { className: 'contact-header' });
        const info = createElement('div', { className: 'contact-info' });
        info.appendChild(createElement('h3', { text: contact.name }));
        info.appendChild(createElement('div', { className: 'last-contact', text: `Last contacted: ${formatDate(contact.lastContact)}` }));
        info.appendChild(createElement('div', { className: 'phone', text: contact.phone }));
        if (contact.company) {
            info.appendChild(createElement('div', {
                className: 'phone company-name',
                text: contact.company
            }));
        }

        const tagsContainer = createElement('div', { className: 'tags-container' });
        (contact.tags || []).forEach(tag => {
            tagsContainer.appendChild(createElement('span', { className: `tag ${tag.toLowerCase()}`, text: tag }));
        });
        info.appendChild(tagsContainer);

        const actions = createElement('div', { className: 'contact-actions' });
        const viewButton = createElement('button', {
            className: 'action-btn btn-more',
            text: 'More',
            attributes: { type: 'button', 'data-action': 'view-contact', 'data-contact-id': contact.id }
        });
        const emailLink = createElement('a', {
            className: 'action-btn btn-email',
            text: '📧 Email',
            attributes: { href: `mailto:${contact.email}` }
        });
        const textLink = createElement('a', {
            className: 'action-btn btn-text',
            text: '💬 Text',
            attributes: { href: `sms:${contact.phone}` }
        });

        actions.appendChild(viewButton);
        actions.appendChild(emailLink);
        actions.appendChild(textLink);

        header.appendChild(info);
        header.appendChild(actions);
        card.appendChild(header);
        container.appendChild(card);
    });
}

export function renderPagination(container) {
    clearChildren(container);

    const totalPages = Math.ceil(state.filteredContacts.length / state.contactsPerPage);
    if (totalPages <= 1) {
        return;
    }

    const previousButton = createElement('button', {
        text: 'Previous',
        attributes: {
            type: 'button',
            'data-page': String(state.currentPage - 1),
            disabled: state.currentPage === 1 ? 'true' : undefined
        }
    });
    container.appendChild(previousButton);

    for (let page = 1; page <= totalPages; page += 1) {
        if (page === 1 || page === totalPages || Math.abs(page - state.currentPage) <= 2) {
            const pageButton = createElement('button', {
                text: String(page),
                className: page === state.currentPage ? 'active' : '',
                attributes: { type: 'button', 'data-page': String(page) }
            });
            container.appendChild(pageButton);
        } else if (page === state.currentPage - 3 || page === state.currentPage + 3) {
            container.appendChild(createElement('span', { text: '…' }));
        }
    }

    const nextButton = createElement('button', {
        text: 'Next',
        attributes: {
            type: 'button',
            'data-page': String(state.currentPage + 1),
            disabled: state.currentPage === totalPages ? 'true' : undefined
        }
    });
    container.appendChild(nextButton);

    container.appendChild(createElement('div', {
        className: 'page-info',
        text: `Page ${state.currentPage} of ${totalPages}`
    }));
}

export function changePage(pageNumber) {
    const totalPages = Math.ceil(state.filteredContacts.length / state.contactsPerPage);
    if (pageNumber < 1 || pageNumber > totalPages) {
        return false;
    }
    state.currentPage = pageNumber;
    return true;
}

export function getContactById(id) {
    return state.contacts.find(contact => contact.id === id) || null;
}

export function upsertContact(contact) {
    const existingIndex = state.contacts.findIndex(item => item.id === contact.id);
    if (existingIndex >= 0) {
        state.contacts[existingIndex] = contact;
    } else {
        state.contacts.unshift(contact);
    }
}

export function updateTotalContacts(element) {
    if (!element) return;
    element.textContent = String(state.contacts.length);
}
