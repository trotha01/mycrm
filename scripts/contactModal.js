import {
    state,
    getNextContactId,
    resetCurrentTags,
    setEditingId
} from './state.js';
import { renderCurrentTags, resetTagInput } from './tagManager.js';

let elements = {};
let onSaveCallback = () => {};

export function setupContactModal(domElements, { onSave } = {}) {
    elements = domElements;
    onSaveCallback = onSave || (() => {});

    if (!elements.modal) {
        throw new Error('Contact modal elements must include a modal reference.');
    }

    elements.saveButton.addEventListener('click', handleSave);
    elements.cancelButton.addEventListener('click', closeContactModal);
}

export function openAddModal() {
    setEditingId(null);
    resetCurrentTags([]);
    resetTagInput();

    elements.title.textContent = 'Add New Contact';
    elements.name.value = '';
    elements.email.value = '';
    elements.phone.value = '';
    elements.modal.style.display = 'block';
    renderCurrentTags();
}

export function openEditModal(contact) {
    if (!contact) return;
    setEditingId(contact.id);
    resetCurrentTags(contact.tags || []);
    resetTagInput();

    elements.title.textContent = 'Edit Contact';
    elements.name.value = contact.name;
    elements.email.value = contact.email;
    elements.phone.value = contact.phone;
    elements.modal.style.display = 'block';
    renderCurrentTags();
}

export function closeContactModal() {
    elements.modal.style.display = 'none';
}

export function populateContactForm({ name, email, phone, tags } = {}) {
    if (typeof name === 'string') {
        elements.name.value = name;
    }
    if (typeof email === 'string') {
        elements.email.value = email;
    }
    if (typeof phone === 'string') {
        elements.phone.value = phone;
    }
    if (Array.isArray(tags)) {
        resetCurrentTags(tags);
        resetTagInput();
    }
}

function handleSave() {
    const name = elements.name.value.trim();
    const email = elements.email.value.trim();
    const phone = elements.phone.value.trim();

    if (!name || !email || !phone) {
        alert('Please fill in all fields');
        return;
    }

    const contact = {
        id: state.editingId || getNextContactId(),
        name,
        email,
        phone,
        lastContact: state.editingId ? state.contacts.find(item => item.id === state.editingId)?.lastContact || new Date().toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        tags: [...state.currentContactTags]
    };

    onSaveCallback(contact);
    closeContactModal();
}
