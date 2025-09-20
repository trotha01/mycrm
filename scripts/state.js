export const initialContacts = [
    { id: 1, name: 'John Smith', email: 'john@example.com', phone: '+1 (555) 123-4567', lastContact: '2024-03-15', tags: ['client', 'vip'] },
    { id: 2, name: 'Sarah Johnson', email: 'sarah@example.com', phone: '+1 (555) 234-5678', lastContact: '2024-03-14', tags: ['prospect', 'marketing'] },
    { id: 3, name: 'Mike Davis', email: 'mike@example.com', phone: '+1 (555) 345-6789', lastContact: '2024-03-13', tags: ['client', 'tech'] },
    { id: 4, name: 'Emily Brown', email: 'emily@example.com', phone: '+1 (555) 456-7890', lastContact: '2024-03-12', tags: ['vendor', 'supplies'] },
    { id: 5, name: 'David Wilson', email: 'david@example.com', phone: '+1 (555) 567-8901', lastContact: '2024-03-11', tags: ['client', 'enterprise'] },
    { id: 6, name: 'Lisa Anderson', email: 'lisa@example.com', phone: '+1 (555) 678-9012', lastContact: '2024-03-10', tags: ['partner', 'referral'] },
    { id: 7, name: 'Robert Taylor', email: 'robert@example.com', phone: '+1 (555) 789-0123', lastContact: '2024-03-09', tags: ['prospect', 'cold'] },
    { id: 8, name: 'Jennifer Martinez', email: 'jennifer@example.com', phone: '+1 (555) 890-1234', lastContact: '2024-03-08', tags: ['client', 'legal'] },
    { id: 9, name: 'Chris Lee', email: 'chris@example.com', phone: '+1 (555) 901-2345', lastContact: '2024-03-07', tags: ['vendor', 'tech'] },
    { id: 10, name: 'Amanda White', email: 'amanda@example.com', phone: '+1 (555) 012-3456', lastContact: '2024-03-06', tags: ['partner', 'marketing'] },
    { id: 11, name: 'Kevin Garcia', email: 'kevin@example.com', phone: '+1 (555) 123-7890', lastContact: '2024-03-05', tags: ['prospect', 'enterprise'] },
    { id: 12, name: 'Michelle Rodriguez', email: 'michelle@example.com', phone: '+1 (555) 234-8901', lastContact: '2024-03-04', tags: ['client', 'design'] }
];

export const state = {
    contacts: [...initialContacts],
    filteredContacts: [...initialContacts],
    currentPage: 1,
    contactsPerPage: 6,
    editingId: null,
    extractedContactData: null,
    currentContactTags: [],
    activeTagFilters: [],
    uploadedCardImages: []
};

export function getNextContactId() {
    if (state.contacts.length === 0) {
        return 1;
    }
    return Math.max(...state.contacts.map(contact => contact.id)) + 1;
}

export function resetCurrentTags(tags = []) {
    state.currentContactTags = [...tags];
}

export function setFilteredContacts(contacts) {
    state.filteredContacts = contacts;
}

export function setEditingId(id) {
    state.editingId = id;
}

export function setExtractedContactData(data) {
    state.extractedContactData = data;
}

export function setUploadedCardImages(images) {
    state.uploadedCardImages = images;
}

export function resetPagination() {
    state.currentPage = 1;
}
