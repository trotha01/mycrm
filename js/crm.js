(() => {
// Sample data
        let contacts = [
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

        let filteredContacts = [...contacts];
        let currentPage = 1;
        const contactsPerPage = 6;
        let editingId = null;
        let extractedContactData = null;
        let currentContactTags = [];
        let activeTagFilters = [];

        // Tags functionality
        function getAllTags() {
            const allTags = new Set();
            contacts.forEach(contact => {
                if (contact.tags) {
                    contact.tags.forEach(tag => allTags.add(tag.toLowerCase()));
                }
            });
            return Array.from(allTags).sort();
        }

        function updateTagFilters() {
            const allTags = getAllTags();
            const tagFilters = document.getElementById('tagFilters');

            if (allTags.length === 0) {
                tagFilters.innerHTML = '';
                return;
            }

            const filtersHTML = `
                <div style="color: #6c757d; font-size: 0.9rem; font-weight: 500; margin-right: 15px;">Filter by tags:</div>
                ${allTags.map(tag => `
                    <span class="filter-tag ${activeTagFilters.includes(tag) ? 'active' : ''}" onclick="toggleTagFilter('${tag}')">
                        ${tag}
                    </span>
                `).join('')}
                ${activeTagFilters.length > 0 ? '<button class="clear-filters" onclick="clearTagFilters()">Clear All</button>' : ''}
            `;

            tagFilters.innerHTML = filtersHTML;
        }

        function toggleTagFilter(tag) {
            const index = activeTagFilters.indexOf(tag);
            if (index === -1) {
                activeTagFilters.push(tag);
            } else {
                activeTagFilters.splice(index, 1);
            }
            updateTagFilters();
            searchContacts();
        }

        function clearTagFilters() {
            activeTagFilters = [];
            updateTagFilters();
            searchContacts();
        }

        function updateCurrentTagsDisplay() {
            const container = document.getElementById('currentTags');

            if (currentContactTags.length === 0) {
                container.innerHTML = '<div style="color: #6c757d; font-size: 0.85rem; font-style: italic;">No tags added</div>';
            } else {
                container.innerHTML = currentContactTags.map((tag, index) => `
                    <span class="tag-editable">
                        ${tag}
                        <button class="tag-remove" onclick="removeTag(${index})" type="button">×</button>
                    </span>
                `).join('');
            }
        }

        function addTag(tagName) {
            if (!tagName) return;

            const normalizedTag = tagName.toLowerCase().trim();

            if (currentContactTags.some(tag => tag.toLowerCase() === normalizedTag)) {
                return;
            }

            const properTag = tagName.charAt(0).toUpperCase() + tagName.slice(1).toLowerCase();
            currentContactTags.push(properTag);
            updateCurrentTagsDisplay();

            document.getElementById('contactTags').value = '';
            document.getElementById('tagSuggestions').style.display = 'none';
        }

        function removeTag(index) {
            currentContactTags.splice(index, 1);
            updateCurrentTagsDisplay();
        }

        function showTagSuggestions(input) {
            const allTags = getAllTags();
            const suggestions = document.getElementById('tagSuggestions');

            const matchingTags = allTags.filter(tag => 
                tag.includes(input) && !currentContactTags.some(existing => existing.toLowerCase() === tag)
            );

            const commonTags = ['client', 'prospect', 'partner', 'vendor', 'vip', 'enterprise', 'marketing', 'tech', 'legal', 'design', 'sales', 'support'];
            const additionalSuggestions = commonTags.filter(tag => 
                tag.includes(input) && 
                !currentContactTags.some(existing => existing.toLowerCase() === tag) &&
                !matchingTags.includes(tag)
            );

            const allSuggestions = [...matchingTags, ...additionalSuggestions].slice(0, 5);

            if (allSuggestions.length > 0) {
                suggestions.innerHTML = allSuggestions.map(tag => `
                    <div class="tag-suggestion" onclick="addTag('${tag}')">
                        <span class="tag ${tag}">${tag}</span>
                        <span>Add tag</span>
                    </div>
                `).join('');
                suggestions.style.display = 'block';
            } else {
                suggestions.style.display = 'none';
            }
        }

        function setupTagsInput() {
            const tagsInput = document.getElementById('contactTags');
            const suggestions = document.getElementById('tagSuggestions');

            tagsInput.replaceWith(tagsInput.cloneNode(true));
            const newTagsInput = document.getElementById('contactTags');

            newTagsInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addTag(this.value.trim());
                    this.value = '';
                    suggestions.style.display = 'none';
                }
            });

            newTagsInput.addEventListener('input', function() {
                const value = this.value.toLowerCase().trim();
                if (value.length > 0) {
                    showTagSuggestions(value);
                } else {
                    suggestions.style.display = 'none';
                }
            });

            newTagsInput.addEventListener('blur', function() {
                setTimeout(() => {
                    suggestions.style.display = 'none';
                }, 200);
            });
        }

        // Date formatting
        function formatDate(dateString) {
            const date = new Date(dateString);
            const today = new Date();
            const diffTime = Math.abs(today - date);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays === 1) return 'Yesterday';
            if (diffDays <= 7) return `${diffDays} days ago`;
            if (diffDays <= 30) return `${Math.ceil(diffDays / 7)} weeks ago`;
            return date.toLocaleDateString();
        }

        function displayContacts() {
            const startIndex = (currentPage - 1) * contactsPerPage;
            const endIndex = startIndex + contactsPerPage;
            const pageContacts = filteredContacts.slice(startIndex, endIndex);

            const contactGrid = document.getElementById('contactGrid');

            if (pageContacts.length === 0) {
                contactGrid.innerHTML = `
                    <div class="empty-state">
                        <h3>No contacts found</h3>
                        <p>Try adjusting your search or add a new contact.</p>
                    </div>
                `;
                return;
            }

            contactGrid.innerHTML = pageContacts.map(contact => `
                <div class="contact-card">
                    <div class="contact-header">
                        <div class="contact-info">
                            <h3>${contact.name}</h3>
                            <div class="last-contact">Last contacted: ${formatDate(contact.lastContact)}</div>
                            <div class="phone">${contact.phone}</div>
                            ${contact.company ? `<div class="phone" style="color: #6c757d; font-style: italic;">${contact.company}</div>` : ''}
                            <div class="tags-container">
                                ${contact.tags ? contact.tags.map(tag => `<span class="tag ${tag.toLowerCase()}">${tag}</span>`).join('') : ''}
                            </div>
                        </div>
                        <div class="contact-actions">
                            <button class="action-btn btn-more" onclick="viewContact(${contact.id})">More</button>
                            <a href="mailto:${contact.email}" class="action-btn btn-email">📧 Email</a>
                            <a href="sms:${contact.phone}" class="action-btn btn-text">💬 Text</a>
                        </div>
                    </div>
                </div>
            `).join('');
        }

        function displayPagination() {
            const totalPages = Math.ceil(filteredContacts.length / contactsPerPage);
            const pagination = document.getElementById('pagination');

            if (totalPages <= 1) {
                pagination.innerHTML = '';
                return;
            }

            let paginationHTML = `
                <button ${currentPage === 1 ? 'disabled' : ''} onclick="changePage(${currentPage - 1})">Previous</button>
            `;

            for (let i = 1; i <= totalPages; i++) {
                if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
                    paginationHTML += `
                        <button class="${i === currentPage ? 'active' : ''}" onclick="changePage(${i})">${i}</button>
                    `;
                } else if (i === currentPage - 3 || i === currentPage + 3) {
                    paginationHTML += '<span>...</span>';
                }
            }

            paginationHTML += `
                <button ${currentPage === totalPages ? 'disabled' : ''} onclick="changePage(${currentPage + 1})">Next</button>
                <div class="page-info">Page ${currentPage} of ${totalPages}</div>
            `;

            pagination.innerHTML = paginationHTML;
        }

        function changePage(page) {
            const totalPages = Math.ceil(filteredContacts.length / contactsPerPage);
            if (page >= 1 && page <= totalPages) {
                currentPage = page;
                displayContacts();
                displayPagination();
            }
        }

        function searchContacts() {
            const searchTerm = document.getElementById('searchInput').value.toLowerCase();

            filteredContacts = contacts.filter(contact => {
                const matchesSearch = contact.name.toLowerCase().includes(searchTerm) ||
                    contact.email.toLowerCase().includes(searchTerm) ||
                    contact.phone.includes(searchTerm) ||
                    (contact.tags && contact.tags.some(tag => tag.toLowerCase().includes(searchTerm)));

                const matchesTags = activeTagFilters.length === 0 || 
                    activeTagFilters.some(filterTag => 
                        contact.tags && contact.tags.some(contactTag => 
                            contactTag.toLowerCase() === filterTag.toLowerCase()
                        )
                    );

                return matchesSearch && matchesTags;
            });

            currentPage = 1;
            displayContacts();
            displayPagination();
        }

        function openAddModal() {
            editingId = null;
            currentContactTags = [];
            document.getElementById('modalTitle').textContent = 'Add New Contact';
            document.getElementById('contactName').value = '';
            document.getElementById('contactEmail').value = '';
            document.getElementById('contactPhone').value = '';
            document.getElementById('contactTags').value = '';
            updateCurrentTagsDisplay();
            document.getElementById('contactModal').style.display = 'block';
            setupTagsInput();
        }

        function viewContact(id) {
            const contact = contacts.find(c => c.id === id);
            if (contact) {
                editingId = id;
                currentContactTags = contact.tags ? [...contact.tags] : [];
                document.getElementById('modalTitle').textContent = 'Edit Contact';
                document.getElementById('contactName').value = contact.name;
                document.getElementById('contactEmail').value = contact.email;
                document.getElementById('contactPhone').value = contact.phone;
                document.getElementById('contactTags').value = '';
                updateCurrentTagsDisplay();
                document.getElementById('contactModal').style.display = 'block';
                setupTagsInput();
            }
        }

        function closeModal() {
            document.getElementById('contactModal').style.display = 'none';
        }

        function saveContact() {
            const name = document.getElementById('contactName').value.trim();
            const email = document.getElementById('contactEmail').value.trim();
            const phone = document.getElementById('contactPhone').value.trim();

            if (!name || !email || !phone) {
                alert('Please fill in all fields');
                return;
            }

            if (editingId) {
                const contactIndex = contacts.findIndex(c => c.id === editingId);
                contacts[contactIndex] = {
                    ...contacts[contactIndex],
                    name,
                    email,
                    phone,
                    tags: [...currentContactTags]
                };
            } else {
                const newContact = {
                    id: Math.max(...contacts.map(c => c.id)) + 1,
                    name,
                    email,
                    phone,
                    lastContact: new Date().toISOString().split('T')[0],
                    tags: [...currentContactTags]
                };
                contacts.unshift(newContact);
            }

            searchContacts();
            updateTagFilters();
            closeModal();
        }

        // Upload functionality
const DEFAULT_OCR_ADJUSTMENTS = {
    cropTop: 5,
    cropBottom: 5,
    cropLeft: 5,
    cropRight: 5,
    rotation: 0
};

function updateUploadProgress(percent) {
    const fill = document.getElementById('progressFill');
    const percentLabel = document.getElementById('progressPercent');
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    if (fill) {
        fill.style.width = value + '%';
    }
    if (percentLabel) {
        percentLabel.textContent = value + '%';
    }
}

function updateUploadStatus(text) {
    const status = document.getElementById('processingText');
    if (status) {
        status.textContent = text;
    }
}

function openUploadModal() {
    const modal = document.getElementById('uploadModal');
    if (modal) {
        modal.style.display = 'block';
    }
    resetUploadModal();
}

function closeUploadModal() {
    const modal = document.getElementById('uploadModal');
    if (modal) {
        modal.style.display = 'none';
    }
    resetUploadModal();
}

function resetUploadModal() {
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.value = '';
    }
    const preview = document.getElementById('previewContainer');
    if (preview) {
        preview.innerHTML = '';
    }
    const indicator = document.getElementById('processingIndicator');
    if (indicator) {
        indicator.style.display = 'none';
    }
    const extracted = document.getElementById('extractedInfo');
    if (extracted) {
        extracted.style.display = 'none';
    }
    const createBtn = document.getElementById('createFromUpload');
    if (createBtn) {
        createBtn.style.display = 'none';
    }
    const uploadArea = document.getElementById('uploadArea');
    if (uploadArea) {
        uploadArea.className = 'upload-area';
    }
    updateUploadProgress(0);
    updateUploadStatus('Initializing OCR engine...');
    const infoGrid = document.getElementById('infoGrid');
    if (infoGrid) {
        infoGrid.innerHTML = '';
    }
    extractedContactData = null;
}

function handleFileUpload(event) {
    const file = event.target && event.target.files ? event.target.files[0] : null;
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const dataUrl = e.target.result;
        const previewContainer = document.getElementById('previewContainer');
        if (previewContainer) {
            previewContainer.innerHTML = `
                <img src="${dataUrl}" class="preview-image" alt="Business card preview">
            `;
        }

        const image = new Image();
        image.onload = () => processBusinessCardImage(image);
        image.onerror = () => {
            console.error('Unable to load the selected image.');
            updateUploadStatus('Unable to load the selected image.');
            updateUploadProgress(0);
            const indicator = document.getElementById('processingIndicator');
            if (indicator) indicator.style.display = 'none';
            const uploadArea = document.getElementById('uploadArea');
            if (uploadArea) uploadArea.className = 'upload-area';
            alert('Unable to load the selected image. Please try a different file.');
        };
        image.src = dataUrl;
    };
    reader.readAsDataURL(file);
}

async function processBusinessCardImage(imageElement) {
    const uploadArea = document.getElementById('uploadArea');
    const indicator = document.getElementById('processingIndicator');
    if (uploadArea) {
        uploadArea.className = 'upload-area processing';
    }
    if (indicator) {
        indicator.style.display = 'block';
    }
    updateUploadStatus('Preparing image analysis...');
    updateUploadProgress(5);

    if (typeof window.extractCardData !== 'function') {
        console.error('extractCardData is not available.');
        updateUploadStatus('OCR engine is still loading. Please try again.');
        if (indicator) indicator.style.display = 'none';
        if (uploadArea) uploadArea.className = 'upload-area';
        alert('OCR engine is still loading. Please try again in a moment.');
        return;
    }

    try {
        const result = await window.extractCardData(imageElement, DEFAULT_OCR_ADJUSTMENTS, {
            onProgress: (value) => updateUploadProgress(value),
            onStatus: (text) => updateUploadStatus(text)
        });
        const contactInfo = buildContactFromStructured(result.structured || {});
        displayExtractedInfo(contactInfo);
    } catch (error) {
        console.error('Processing Error:', error);
        updateUploadStatus('Failed to process the image.');
        updateUploadProgress(0);
        if (indicator) indicator.style.display = 'none';
        if (uploadArea) uploadArea.className = 'upload-area';
        alert('Failed to process the image. Please try again.');
    }
}

function buildContactFromStructured(structured) {
    const fields = structured.fields || {};
    const rawText = structured.raw_text || '';
    const fallback = parseContactInfo(rawText);

    const trimValue = (value) => (typeof value === 'string' ? value.trim() : '');
    const name = fields.name && fields.name.value ? trimValue(fields.name.value) : fallback.name;
    const email = fields.email && fields.email.value ? trimValue(fields.email.value) : fallback.email;
    const phone = fields.phone && fields.phone.value ? trimValue(fields.phone.value) : fallback.phone;

    return {
        name: (name || fallback.name || '').trim(),
        email: (email || fallback.email || '').trim(),
        phone: (phone || fallback.phone || '').trim(),
        company: fallback.company || '',
        title: fallback.title || ''
    };
}

function parseContactInfo(text) {
            const contact = {
                name: '',
                email: '',
                phone: '',
                company: '',
                title: ''
            };

            const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

            const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
            const emailMatches = text.match(emailRegex);
            if (emailMatches && emailMatches.length > 0) {
                contact.email = emailMatches[0].toLowerCase();
            }

            const phoneRegex = /(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})|(\+\d{1,3}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9})/g;
            const phoneMatches = text.match(phoneRegex);
            if (phoneMatches && phoneMatches.length > 0) {
                let phone = phoneMatches[0].replace(/[^\d+]/g, '');
                if (phone.length === 10) {
                    phone = `+1${phone}`;
                }
                if (phone.length === 11 && phone.startsWith('1')) {
                    phone = phone.substring(1);
                }
                if (phone.length === 10) {
                    contact.phone = `+1 (${phone.substring(0,3)}) ${phone.substring(3,6)}-${phone.substring(6)}`;
                } else {
                    contact.phone = phoneMatches[0];
                }
            }

            const titleKeywords = ['ceo', 'cto', 'cfo', 'president', 'director', 'manager', 'lead', 'senior', 'junior', 'associate', 'consultant', 'analyst', 'specialist', 'coordinator', 'supervisor', 'executive', 'officer'];
            const companyKeywords = ['inc', 'llc', 'corp', 'company', 'ltd', 'limited', 'corporation', 'group', 'solutions', 'services', 'consulting', 'partners', 'associates'];

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const lowerLine = line.toLowerCase();

                if (emailRegex.test(line) || phoneRegex.test(line) || line.length < 2 || /^\d+$/.test(line)) {
                    continue;
                }

                const namePattern = /^[A-Za-z]+(?:\s[A-Za-z]+)+$/;
                if (namePattern.test(line) && !contact.name && line.split(' ').length >= 2 && line.split(' ').length <= 4) {
                    const hasCommonTitle = titleKeywords.some(keyword => lowerLine.includes(keyword));
                    const hasCompanyIndicator = companyKeywords.some(keyword => lowerLine.includes(keyword));

                    if (!hasCommonTitle && !hasCompanyIndicator) {
                        contact.name = line;
                        continue;
                    }
                }

                if (titleKeywords.some(keyword => lowerLine.includes(keyword)) && !contact.title) {
                    contact.title = line;
                    continue;
                }

                if (companyKeywords.some(keyword => lowerLine.includes(keyword)) && !contact.company) {
                    contact.company = line;
                    continue;
                }

                if (!contact.name && line.split(' ').length >= 2 && line.split(' ').length <= 3 && 
                    !lowerLine.includes('www') && !lowerLine.includes('.com') && 
                    !/\d/.test(line) && line.length > 5) {
                    contact.name = line;
                }
            }

            if (!contact.name) {
                for (const line of lines) {
                    if (line.length > 3 && line.length < 40 && 
                        !emailRegex.test(line) && !phoneRegex.test(line) &&
                        !line.toLowerCase().includes('www') && 
                        !/^\d+/.test(line) &&
                        line.split(' ').length >= 2) {
                        contact.name = line;
                        break;
                    }
                }
            }

            if (!contact.name && lines.length > 0) {
                for (let i = 0; i < Math.min(3, lines.length); i++) {
                    const line = lines[i];
                    if (line.length > 3 && line.split(' ').length >= 2) {
                        contact.name = line;
                        break;
                    }
                }
            }

            Object.keys(contact).forEach(key => {
                if (contact[key]) {
                    contact[key] = contact[key].trim();
                }
            });

            return contact;
        }
        function displayExtractedInfo(data) {
            extractedContactData = data;

            updateUploadProgress(100);
            updateUploadStatus('Analysis complete!');

            document.getElementById('processingIndicator').style.display = 'none';
            document.getElementById('uploadArea').className = 'upload-area';

            const infoGrid = document.getElementById('infoGrid');
            infoGrid.innerHTML = `
                <div class="info-item">
                    <span class="info-label">Name:</span>
                    <span class="info-value">${data.name}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Email:</span>
                    <span class="info-value">${data.email}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Phone:</span>
                    <span class="info-value">${data.phone}</span>
                </div>
                ${data.company ? `
                <div class="info-item">
                    <span class="info-label">Company:</span>
                    <span class="info-value">${data.company}</span>
                </div>
                ` : ''}
                ${data.title ? `
                <div class="info-item">
                    <span class="info-label">Title:</span>
                    <span class="info-value">${data.title}</span>
                </div>
                ` : ''}
            `;

            document.getElementById('extractedInfo').style.display = 'block';
            document.getElementById('createFromUpload').style.display = 'inline-block';
        }

        function createContactFromUpload() {
            if (!extractedContactData) return;

            const newContact = {
                id: Math.max(...contacts.map(c => c.id)) + 1,
                name: extractedContactData.name,
                email: extractedContactData.email,
                phone: extractedContactData.phone,
                company: extractedContactData.company || '',
                title: extractedContactData.title || '',
                lastContact: new Date().toISOString().split('T')[0],
                tags: ['new', 'imported']
            };

            contacts.unshift(newContact);
            searchContacts();
            updateTagFilters();
            closeUploadModal();

            alert(`Contact "${newContact.name}" has been successfully added to your CRM!`);
        }

        function setupDragAndDrop() {
            const uploadArea = document.getElementById('uploadArea');

            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                uploadArea.addEventListener(eventName, preventDefaults, false);
            });

            function preventDefaults(e) {
                e.preventDefault();
                e.stopPropagation();
            }

            ['dragenter', 'dragover'].forEach(eventName => {
                uploadArea.addEventListener(eventName, highlight, false);
            });

            ['dragleave', 'drop'].forEach(eventName => {
                uploadArea.addEventListener(eventName, unhighlight, false);
            });

            function highlight(e) {
                uploadArea.classList.add('dragover');
            }

            function unhighlight(e) {
                uploadArea.classList.remove('dragover');
            }

            uploadArea.addEventListener('drop', handleDrop, false);

            function handleDrop(e) {
                const dt = e.dataTransfer;
                const files = dt.files;

                if (files.length > 0) {
                    const fileInput = document.getElementById('fileInput');
                    fileInput.files = files;
                    handleFileUpload({ target: fileInput });
                }
            }
        }

        window.onclick = function(event) {
            const contactModal = document.getElementById('contactModal');
            const uploadModal = document.getElementById('uploadModal');

            if (event.target === contactModal) {
                closeModal();
            }
            if (event.target === uploadModal) {
                closeUploadModal();
            }
        };

        // Initialize the app
        displayContacts();
        displayPagination();
        setupDragAndDrop();
        updateTagFilters();

const initCRM = () => {
    displayContacts();
    displayPagination();
    setupDragAndDrop();
    updateTagFilters();
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCRM);
} else {
    initCRM();
}

Object.assign(window, {
    searchContacts,
    openAddModal,
    openUploadModal,
    closeUploadModal,
    handleFileUpload,
    createContactFromUpload,
    closeModal,
    saveContact,
    viewContact,
    toggleTagFilter,
    clearTagFilters,
    removeTag,
    addTag
});

})();
