import {
    resetOcrEngine,
    preprocessImage,
    runOCREngine,
    extractContactInfo,
    parseRecognitionSummary
} from './ocrEngine.js';
import {
    state,
    setExtractedContactData,
    setUploadedCardImages
} from './state.js';
import { renderCurrentTags } from './tagManager.js';

let elements = {};
let onReviewRequested = () => {};

export function setupUploadController(domElements, { onReview } = {}) {
    elements = domElements;
    onReviewRequested = onReview || (() => {});

    elements.fileInput.addEventListener('change', handleFileInputChange);
    elements.uploadArea.addEventListener('click', () => elements.fileInput.click());
    elements.reviewButton.addEventListener('click', reviewExtractedContact);
    elements.cancelButton.addEventListener('click', closeUploadModal);

    setupDragAndDrop();
    resetUploadModal();
}

export function openUploadModal() {
    if (!elements.modal) return;
    elements.modal.style.display = 'block';
    resetUploadModal();
}

export function closeUploadModal() {
    if (!elements.modal) return;
    elements.modal.style.display = 'none';
    resetUploadModal();
}

export function reviewExtractedContact() {
    if (!state.extractedContactData) {
        return;
    }

    closeUploadModal();
    renderCurrentTags();
    onReviewRequested(state.extractedContactData);
}

function setupDragAndDrop() {
    const { uploadArea } = elements;
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, preventDefaults, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        uploadArea.addEventListener(eventName, () => uploadArea.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, () => uploadArea.classList.remove('dragover'), false);
    });

    uploadArea.addEventListener('drop', handleDrop, false);
}

function preventDefaults(event) {
    event.preventDefault();
    event.stopPropagation();
}

function handleDrop(event) {
    const files = event.dataTransfer?.files;
    if (files && files.length) {
        processBusinessCard(Array.from(files));
    }
}

function handleFileInputChange(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) {
        return;
    }
    processBusinessCard(files);
}

async function processBusinessCard(fileList) {
    const files = fileList.filter(file => file.type.startsWith('image/')).slice(0, 2);
    if (!files.length) {
        return;
    }

    renderPreview(files);
    elements.uploadArea.classList.add('processing');
    elements.processingIndicator.style.display = 'block';
    updateProcessingText('Preparing images for OCR...');
    updateProgress(5);
    resetStageIndicator();
    setStageStatus('preprocess', 'active');

    try {
        const labeledImages = await Promise.all(files.map((file, index) =>
            readFileAsDataUrl(file).then(dataUrl => ({
                file,
                dataUrl,
                label: index === 0 ? 'front' : 'back'
            }))
        ));
        setUploadedCardImages(labeledImages);

        const preprocessedImages = [];
        for (const image of labeledImages) {
            updateProcessingText(`Preprocessing ${image.label} image...`);
            const processed = await preprocessImage(image.dataUrl);
            preprocessedImages.push({ ...image, preprocessed: processed });
        }

        setStageStatus('preprocess', 'completed');
        setStageStatus('recognize', 'active');
        updateProgress(30);

        const recognitionResults = [];
        let totalConfidence = 0;

        for (let i = 0; i < preprocessedImages.length; i += 1) {
            const image = preprocessedImages[i];
            updateProcessingText(`Recognizing text on ${image.label} side...`);
            const recognition = await runOCREngine(image.preprocessed, image.label, percent => {
                const base = 30 + (i / preprocessedImages.length) * 40;
                const share = 40 / preprocessedImages.length;
                const progressValue = base + (percent / 100) * share;
                updateProgress(Math.min(75, Math.round(progressValue)));
            });
            recognitionResults.push({
                ...image,
                text: recognition.text,
                confidence: recognition.confidence,
                engineUsed: recognition.engineUsed,
                variantUsed: recognition.variantType
            });
            if (typeof recognition.confidence === 'number') {
                totalConfidence += recognition.confidence;
            }
        }

        const averageConfidence = recognitionResults.length ? totalConfidence / recognitionResults.length : 0;
        setStageStatus('recognize', 'completed');
        setStageStatus('parse', 'active');
        updateProgress(85);
        updateProcessingText('Parsing contact fields...');

        const combinedText = recognitionResults.map(result => result.text).join('\n');
        const parsedInfo = await extractContactInfo(combinedText, recognitionResults, averageConfidence);

        setStageStatus('parse', 'completed');
        updateProgress(100);
        updateProcessingText('Finished parsing! Review the extracted information.');

        displayExtractedInfo(parsedInfo, recognitionResults);
        elements.uploadArea.classList.remove('processing');
    } catch (error) {
        console.error('Failed to process business card', error);
        updateProcessingText('Unable to process the card. Please try again or enter details manually.');
        updateProgress(100);
        elements.uploadArea.classList.remove('processing');
    }
}

function renderPreview(files) {
    elements.previewContainer.innerHTML = '';
    if (!files.length) {
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'preview-grid';

    files.forEach((file, index) => {
        const card = document.createElement('div');
        card.className = 'preview-card';

        const title = document.createElement('h4');
        title.textContent = index === 0 ? 'Front Side' : 'Back Side';
        card.appendChild(title);

        const img = new Image();
        img.className = 'preview-image';
        img.alt = `Business card ${index === 0 ? 'front' : 'back'} preview`;

        const reader = new FileReader();
        reader.onload = event => {
            img.src = event.target?.result;
        };
        reader.readAsDataURL(file);

        card.appendChild(img);
        grid.appendChild(card);
    });

    elements.previewContainer.appendChild(grid);
}

function displayExtractedInfo(parsedInfo, recognitionResults) {
    setExtractedContactData(parsedInfo);

    elements.extractedInfo.style.display = 'block';
    elements.reviewButton.style.display = 'inline-block';

    elements.extractedName.textContent = parsedInfo.name || '—';
    elements.extractedEmail.textContent = parsedInfo.email || '—';
    elements.extractedPhone.textContent = parsedInfo.phone || '—';
    elements.extractedCompany.textContent = parsedInfo.company || '—';
    elements.extractedTitle.textContent = parsedInfo.title || '—';
    elements.extractedConfidence.textContent =
        parsedInfo.confidence != null ? `${parsedInfo.confidence.toFixed(2)}%` : '—';

    elements.extractedSegments.innerHTML = parseRecognitionSummary(recognitionResults)
        .map(segment => `
            <div class="segment-card">
                <div class="segment-header">
                    <span class="segment-side">${segment.side.toUpperCase()} SIDE</span>
                    <span class="segment-confidence">${segment.confidence != null ? `${segment.confidence.toFixed(2)}%` : '—'} (${segment.engine})</span>
                </div>
                ${segment.variant ? `
                    <span class="info-label">Variant</span>
                    <span class="info-value">${segment.variant}</span>
                ` : ''}
                <span class="info-label">Text</span>
                <span class="info-value" style="white-space: pre-wrap; text-align: left;">${segment.text || '—'}</span>
            </div>
        `)
        .join('');
}

function resetUploadModal() {
    if (!elements.fileInput) return;
    elements.fileInput.value = '';
    elements.previewContainer.innerHTML = '';
    elements.processingIndicator.style.display = 'none';
    elements.extractedInfo.style.display = 'none';
    elements.reviewButton.style.display = 'none';
    elements.uploadArea.classList.remove('processing');
    updateProgress(0);
    updateProcessingText('Initializing OCR engine...');
    resetStageIndicator();
    resetOcrEngine();
    setUploadedCardImages([]);
    setExtractedContactData(null);
}

function updateProgress(percentage) {
    elements.progressFill.style.width = `${percentage}%`;
    elements.progressPercent.textContent = `${percentage}%`;
}

function updateProcessingText(text) {
    elements.processingText.textContent = text;
}

function resetStageIndicator() {
    elements.stageElements.forEach(stage => {
        stage.classList.remove('active', 'completed');
    });
}

function setStageStatus(stageName, status) {
    const stage = elements.stageElements.find(item => item.dataset.stage === stageName);
    if (!stage) return;
    stage.classList.remove('active', 'completed');
    if (status === 'active') {
        stage.classList.add('active');
    } else if (status === 'completed') {
        stage.classList.add('completed');
    }
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
