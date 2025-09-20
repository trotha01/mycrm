import {
    applyFilters,
    renderContacts,
    renderPagination,
    changePage,
    getContactById,
    upsertContact,
    updateTotalContacts
} from './contactList.js';
import {
    setupTagManager,
    renderTagFilters,
    renderCurrentTags
} from './tagManager.js';
import {
    setupContactModal,
    openAddModal,
    openEditModal,
    closeContactModal,
    populateContactForm
} from './contactModal.js';
import {
    setupUploadController,
    openUploadModal,
    closeUploadModal
} from './upload.js';

const dom = {};

function cacheDomReferences() {
    dom.searchInput = document.getElementById('searchInput');
    dom.addContactButton = document.getElementById('addContactButton');
    dom.uploadCardButton = document.getElementById('uploadCardButton');
    dom.contactGrid = document.getElementById('contactGrid');
    dom.pagination = document.getElementById('pagination');
    dom.tagFilters = document.getElementById('tagFilters');
    dom.tagSuggestions = document.getElementById('tagSuggestions');
    dom.currentTags = document.getElementById('currentTags');
    dom.contactTagsInput = document.getElementById('contactTags');
    dom.totalContacts = document.getElementById('totalContacts');

    dom.contactModal = document.getElementById('contactModal');
    dom.contactModalTitle = document.getElementById('modalTitle');
    dom.contactName = document.getElementById('contactName');
    dom.contactEmail = document.getElementById('contactEmail');
    dom.contactPhone = document.getElementById('contactPhone');
    dom.saveContactButton = document.getElementById('saveContactButton');
    dom.cancelContactButton = document.getElementById('cancelContactButton');

    dom.uploadModal = document.getElementById('uploadModal');
    dom.uploadArea = document.getElementById('uploadArea');
    dom.fileInput = document.getElementById('fileInput');
    dom.previewContainer = document.getElementById('previewContainer');
    dom.processingIndicator = document.getElementById('processingIndicator');
    dom.progressFill = document.getElementById('progressFill');
    dom.progressPercent = document.getElementById('progressPercent');
    dom.processingText = document.getElementById('processingText');
    dom.stageElements = Array.from(document.querySelectorAll('.stage'));
    dom.extractedInfo = document.getElementById('extractedInfo');
    dom.extractedName = document.getElementById('extractedName');
    dom.extractedEmail = document.getElementById('extractedEmail');
    dom.extractedPhone = document.getElementById('extractedPhone');
    dom.extractedCompany = document.getElementById('extractedCompany');
    dom.extractedTitle = document.getElementById('extractedTitle');
    dom.extractedConfidence = document.getElementById('extractedConfidence');
    dom.extractedSegments = document.getElementById('extractedSegments');
    dom.reviewFromUpload = document.getElementById('reviewFromUpload');
    dom.cancelUploadButton = document.getElementById('cancelUploadButton');
}

function initializeTagManager() {
    setupTagManager({
        input: dom.contactTagsInput,
        suggestions: dom.tagSuggestions,
        tags: dom.currentTags,
        filters: dom.tagFilters
    }, handleFiltersChanged);
}

function initializeContactModal() {
    setupContactModal({
        modal: dom.contactModal,
        title: dom.contactModalTitle,
        name: dom.contactName,
        email: dom.contactEmail,
        phone: dom.contactPhone,
        saveButton: dom.saveContactButton,
        cancelButton: dom.cancelContactButton
    }, {
        onSave: handleContactSave
    });
}

function initializeUploadController() {
    setupUploadController({
        modal: dom.uploadModal,
        uploadArea: dom.uploadArea,
        fileInput: dom.fileInput,
        previewContainer: dom.previewContainer,
        processingIndicator: dom.processingIndicator,
        progressFill: dom.progressFill,
        progressPercent: dom.progressPercent,
        processingText: dom.processingText,
        stageElements: dom.stageElements,
        extractedInfo: dom.extractedInfo,
        extractedName: dom.extractedName,
        extractedEmail: dom.extractedEmail,
        extractedPhone: dom.extractedPhone,
        extractedCompany: dom.extractedCompany,
        extractedTitle: dom.extractedTitle,
        extractedConfidence: dom.extractedConfidence,
        extractedSegments: dom.extractedSegments,
        reviewButton: dom.reviewFromUpload,
        cancelButton: dom.cancelUploadButton
    }, {
        onReview: handleReviewExtracted
    });
}

function bindEvents() {
    dom.searchInput.addEventListener('input', () => {
        applyFilters(dom.searchInput.value);
        refreshContacts();
    });

    dom.addContactButton.addEventListener('click', () => {
        openAddModal();
    });

    dom.uploadCardButton.addEventListener('click', () => {
        openUploadModal();
    });

    dom.contactGrid.addEventListener('click', event => {
        const actionTarget = event.target.closest('[data-action="view-contact"]');
        if (actionTarget) {
            const contactId = Number(actionTarget.dataset.contactId);
            if (!Number.isNaN(contactId)) {
                const contact = getContactById(contactId);
                openEditModal(contact);
            }
        }
    });

    dom.pagination.addEventListener('click', event => {
        const button = event.target.closest('[data-page]');
        if (!button || button.hasAttribute('disabled')) {
            return;
        }
        const page = Number(button.dataset.page);
        if (changePage(page)) {
            renderContacts(dom.contactGrid);
            renderPagination(dom.pagination);
        }
    });

    document.addEventListener('click', event => {
        if (event.target === dom.contactModal) {
            closeContactModal();
        }
        if (event.target === dom.uploadModal) {
            closeUploadModal();
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            closeContactModal();
            closeUploadModal();
        }
    });
}

function handleFiltersChanged() {
    applyFilters(dom.searchInput.value);
    renderContacts(dom.contactGrid);
    renderPagination(dom.pagination);
}

function handleContactSave(contact) {
    upsertContact(contact);
    applyFilters(dom.searchInput.value);
    refreshContacts();
    renderTagFilters();
    renderCurrentTags();
    updateTotalContacts(dom.totalContacts);
}

function handleReviewExtracted(data) {
    openAddModal();
    populateContactForm({
        name: data.name,
        email: data.email,
        phone: data.phone,
        tags: data.tags
    });
    renderCurrentTags();
}

function refreshContacts() {
    renderContacts(dom.contactGrid);
    renderPagination(dom.pagination);
    updateTotalContacts(dom.totalContacts);
}

function initialize() {
    cacheDomReferences();
    initializeTagManager();
    initializeContactModal();
    initializeUploadController();
    bindEvents();

    applyFilters('');
    refreshContacts();
}

document.addEventListener('DOMContentLoaded', initialize);
