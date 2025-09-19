function resolvePreferredEngine() {
    try {
        const stored = typeof window !== 'undefined' ? window.localStorage?.getItem('ocr.engine') : null;
        if (stored === 'ppocr') {
            return 'ppocr';
        }
    } catch (error) {
        console.warn('Unable to read persisted OCR engine preference, defaulting to Tesseract.', error);
    }
    return 'tesseract';
}

const defaultEngine = resolvePreferredEngine();

export const ocrConfig = {
    engine: defaultEngine,
    fallbackEngine: 'tesseract',
    confidenceThreshold: 0.58,
    currentEngine: defaultEngine
};

const fieldParserScripts = {
    libphonenumber: 'https://cdn.jsdelivr.net/npm/libphonenumber-js@1.12.17/bundle/libphonenumber-max.js'
};

const scriptRegistry = new Map();
const ocrModelBuffers = {};
const ppocrModelManifest = {
    detector: null,
    recognizer: null,
    dictionary: null
};

let ppocrInitialized = false;

export function resetOcrEngine() {
    const preferred = resolvePreferredEngine();
    ocrConfig.engine = preferred;
    ocrConfig.currentEngine = preferred;
}

export async function ensureFieldParsers() {
    const loaders = Object.entries(fieldParserScripts).map(async ([key, url]) => {
        try {
            await loadScriptOnce(key, url, { crossOrigin: 'anonymous' });
        } catch (error) {
            console.warn(`Failed to load ${key} parser from ${url}. Falling back to heuristic parsing.`, error);
        }
    });
    await Promise.all(loaders);

    if (typeof window !== 'undefined' && !window.libphonenumber) {
        console.warn('libphonenumber-js is unavailable; phone numbers will use regex-based parsing.');
    }
}

export async function ensureTesseract() {
    await loadScriptOnce('tesseract', 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js', {
        crossOrigin: 'anonymous'
    });
}

async function fetchModelBuffer(key, url) {
    if (ocrModelBuffers[key]) {
        return ocrModelBuffers[key];
    }
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) {
        throw new Error(`Failed to fetch ${key} model: ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    ocrModelBuffers[key] = buffer;
    return buffer;
}

function resolveManifestOverrides() {
    if (typeof window === 'undefined') {
        return;
    }
    const overrides = window.__PPOCR_MANIFEST__;
    if (overrides && typeof overrides === 'object') {
        Object.entries(overrides).forEach(([key, value]) => {
            if (key in ppocrModelManifest && typeof value === 'string' && value.trim().length > 0) {
                ppocrModelManifest[key] = value.trim();
            }
        });
    }
}

async function ensurePPOCREngine() {
    if (ppocrInitialized) {
        return;
    }

    resolveManifestOverrides();

    const missingAssets = Object.entries(ppocrModelManifest)
        .filter(([, value]) => typeof value !== 'string' || value.length === 0)
        .map(([key]) => key);

    if (missingAssets.length > 0) {
        throw new Error(`PP-OCR assets missing: ${missingAssets.join(', ')}`);
    }

    await Promise.all([
        loadScriptOnce('opencv', 'https://docs.opencv.org/4.9.0/opencv.js', { crossOrigin: 'anonymous' }),
        loadScriptOnce('ort', 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/ort.min.js', { crossOrigin: 'anonymous' })
    ]);

    await Promise.all([
        fetchModelBuffer('detector', ppocrModelManifest.detector),
        fetchModelBuffer('recognizer', ppocrModelManifest.recognizer),
        fetchModelBuffer('dictionary', ppocrModelManifest.dictionary)
    ]);

    ppocrInitialized = true;
}

export async function runOCREngine(imageDataUrl, label, progressCallback) {
    if (ocrConfig.currentEngine === 'ppocr') {
        try {
            await ensurePPOCREngine();
            const ppocrResult = await runPPOCRInference(imageDataUrl, progressCallback);
            if (!ppocrResult.text || (ppocrResult.confidence || 0) < ocrConfig.confidenceThreshold * 100) {
                throw new Error('PP-OCR confidence below threshold');
            }
            return { ...ppocrResult, engineUsed: 'ppocr' };
        } catch (error) {
            console.warn('PP-OCR failed, switching to Tesseract.js fallback.', error);
            ocrConfig.currentEngine = ocrConfig.fallbackEngine;
            return runOCREngine(imageDataUrl, label, progressCallback);
        }
    }

    await ensureTesseract();

    const result = await window.Tesseract.recognize(imageDataUrl, 'eng', {
        logger: message => {
            if (progressCallback && message.status === 'recognizing text') {
                const percentage = Math.round((message.progress || 0) * 100);
                progressCallback(percentage);
            }
        }
    });

    return {
        text: result.data?.text || '',
        confidence: result.data?.confidence || 0,
        engineUsed: 'tesseract'
    };
}

export async function preprocessImage(dataUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);

            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const { data } = imageData;
            for (let i = 0; i < data.length; i += 4) {
                const grayscale = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                data[i] = data[i + 1] = data[i + 2] = grayscale;
            }
            context.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        image.onerror = reject;
        image.src = dataUrl;
    });
}

export async function extractContactInfo(fullText, recognitionResults, averageConfidence) {
    await ensureFieldParsers();

    const info = {
        name: '',
        email: '',
        phone: '',
        company: '',
        title: '',
        rawText: fullText,
        engineUsed: recognitionResults[0]?.engineUsed || ocrConfig.currentEngine,
        confidence: typeof averageConfidence === 'number' ? Number(averageConfidence.toFixed(2)) : null,
        segments: recognitionResults.map(result => ({
            side: result.label,
            text: (result.text || '').trim(),
            confidence: typeof result.confidence === 'number' ? Number(result.confidence.toFixed(2)) : null,
            engine: result.engineUsed
        })),
        tags: []
    };

    const lines = fullText
        .split(/\n+/)
        .map(line => line.trim())
        .filter(line => line.length > 0);

    const normalizedLines = lines.map((line, index) => ({
        index,
        text: line,
        lower: line.toLowerCase()
    }));

    const excludedForName = new Set();

    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi;
    const emailMatch = fullText.match(emailRegex);
    if (emailMatch && emailMatch.length > 0) {
        info.email = emailMatch[0].toLowerCase();
        normalizedLines.forEach(entry => {
            if (entry.lower.includes(info.email)) {
                excludedForName.add(entry.index);
            }
        });
    }

    const phoneParser = window.libphonenumber?.parsePhoneNumberFromString;
    if (phoneParser) {
        for (const entry of normalizedLines) {
            try {
                const parsed = phoneParser(entry.text, 'US');
                if (parsed && parsed.isValid()) {
                    info.phone = parsed.formatInternational();
                    excludedForName.add(entry.index);
                    break;
                }
            } catch (error) {
                // Ignore individual line parse failures and continue with fallbacks.
            }
        }
    }

    if (!info.phone) {
        const fallbackLine = normalizedLines.find(entry => /\d{3}[)\s.-]*\d{3}[\s.-]*\d{4}/.test(entry.text));
        if (fallbackLine) {
            const match = fallbackLine.text.match(/\+?\d[\d\s().-]{7,}/);
            if (match) {
                info.phone = match[0];
                excludedForName.add(fallbackLine.index);
            }
        }
    }

    const titleKeywords = ['ceo', 'cto', 'cfo', 'president', 'director', 'manager', 'lead', 'senior', 'junior', 'associate', 'consultant', 'analyst', 'specialist', 'coordinator', 'supervisor', 'executive', 'officer', 'founder'];
    const companyKeywords = ['inc', 'llc', 'corp', 'company', 'ltd', 'limited', 'corporation', 'group', 'solutions', 'services', 'consulting', 'partners', 'associates', 'studio', 'labs'];

    for (const entry of normalizedLines) {
        if (excludedForName.has(entry.index)) {
            continue;
        }

        if (!info.title && titleKeywords.some(keyword => entry.lower.includes(keyword))) {
            info.title = entry.text;
            excludedForName.add(entry.index);
            continue;
        }

        if (!info.company && companyKeywords.some(keyword => entry.lower.includes(keyword))) {
            info.company = entry.text;
            excludedForName.add(entry.index);
        }
    }

    const nameResult = inferNameFromLines(normalizedLines, excludedForName);
    if (nameResult) {
        info.name = nameResult.value;
        nameResult.indices.forEach(index => excludedForName.add(index));
    }

    if (!info.company) {
        const fallbackCompany = normalizedLines.find(entry => !excludedForName.has(entry.index) && !/\d/.test(entry.text) && entry.text.length > 3);
        if (fallbackCompany) {
            info.company = fallbackCompany.text;
        }
    }

    if (!info.name && info.email) {
        const emailPrefix = info.email.split('@')[0].replace(/[._]/g, ' ');
        info.name = emailPrefix
            .split(' ')
            .filter(Boolean)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    }

    const inferredTags = new Set();
    if (info.title) {
        const lowerTitle = info.title.toLowerCase();
        if (lowerTitle.includes('marketing') || lowerTitle.includes('sales')) {
            inferredTags.add('prospect');
        }
        if (lowerTitle.includes('founder') || lowerTitle.includes('ceo')) {
            inferredTags.add('executive');
        }
        if (lowerTitle.includes('director') || lowerTitle.includes('manager')) {
            inferredTags.add('decision-maker');
        }
    }
    if (info.company) {
        inferredTags.add('imported');
    }
    if (info.engineUsed === 'tesseract') {
        inferredTags.add('ocr:tesseract');
    }
    info.tags = Array.from(inferredTags);

    return info;
}

export function parseRecognitionSummary(recognitionResults) {
    return recognitionResults.map(result => ({
        side: result.label,
        text: (result.text || '').trim(),
        confidence: typeof result.confidence === 'number' ? Number(result.confidence.toFixed(2)) : null,
        engine: result.engineUsed
    }));
}

function inferNameFromLines(lines, excludedIndices) {
    const sanitized = lines
        .filter(entry => !excludedIndices.has(entry.index))
        .map(entry => ({
            index: entry.index,
            tokens: entry.text.split(/\s+/).filter(Boolean)
        }))
        .filter(entry => entry.tokens.length > 0 && entry.tokens.length <= 4);

    const candidates = [];

    for (let i = 0; i < sanitized.length; i += 1) {
        const current = sanitized[i];
        const singleLineCandidate = buildNameCandidate(current);
        if (singleLineCandidate) {
            candidates.push(singleLineCandidate);
        }

        const next = sanitized[i + 1];
        if (next && next.index === current.index + 1) {
            const combinedCandidate = buildNameCandidate({
                index: current.index,
                tokens: [...current.tokens, ...next.tokens],
                indices: [current.index, next.index]
            });
            if (combinedCandidate) {
                candidates.push(combinedCandidate);
            }
        }
    }

    if (candidates.length === 0) {
        return null;
    }

    candidates.sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        return a.indices[0] - b.indices[0];
    });

    return candidates[0];
}

function buildNameCandidate(entry) {
    const indices = entry.indices || [entry.index];
    const normalizedTokens = entry.tokens
        .map(normalizeNameToken)
        .filter(Boolean);

    if (normalizedTokens.length < 2 || normalizedTokens.length > 4) {
        return null;
    }

    if (!normalizedTokens.every(isLikelyNameToken)) {
        return null;
    }

    const formattedTokens = normalizedTokens.map(formatNameToken);
    const score = scoreNameTokens(normalizedTokens, indices.length > 1);

    return {
        value: formattedTokens.join(' '),
        indices,
        score
    };
}

function scoreNameTokens(tokens, isMultiline) {
    let score = tokens.length * 2;
    if (isMultiline) {
        score += 0.5;
    }
    if (tokens.every(token => /^[A-Z][a-zA-Z'.-]*$/.test(token))) {
        score += 0.25;
    }
    if (tokens.some(token => /^[A-Z]{2,}$/.test(token))) {
        score -= 0.2;
    }
    if (tokens.some(token => token.length === 1)) {
        score -= 0.1;
    }
    return score;
}

function formatNameToken(token) {
    if (/^[A-Z]{2,}$/.test(token)) {
        return token.charAt(0) + token.slice(1).toLowerCase();
    }
    if (/^[A-Z]\.$/.test(token)) {
        return token.toUpperCase();
    }
    if (/^[A-Z][a-zA-Z'.-]*$/.test(token)) {
        return token;
    }
    return token.replace(/^[a-z]/, char => char.toUpperCase());
}

function normalizeNameToken(token) {
    const cleaned = token.replace(/^[^A-Za-z]+|[^A-Za-z'.-]+$/g, '');
    if (!cleaned) {
        return '';
    }
    if (/^[A-Z]{2,}$/.test(cleaned)) {
        return cleaned;
    }
    if (/^[A-Z][a-zA-Z'.-]*$/.test(cleaned)) {
        return cleaned;
    }
    if (/^[a-z][a-z'.-]*$/.test(cleaned)) {
        return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
    if (/^[A-Z]\.$/.test(cleaned)) {
        return cleaned.toUpperCase();
    }
    return '';
}

function isLikelyNameToken(token) {
    if (!token) {
        return false;
    }
    if (/[@\d]/.test(token)) {
        return false;
    }
    if (token.length === 1) {
        return /^[A-Z]$/.test(token);
    }
    return /^[A-Z][A-Za-z'.-]*$/.test(token) || /^[A-Z]{2,}$/.test(token);
}

async function runPPOCRInference() {
    throw new Error('PP-OCR inference pipeline is not available in this demo environment');
}

async function loadScriptOnce(key, url, attributes = {}) {
    if (scriptRegistry.has(key)) {
        return scriptRegistry.get(key);
    }

    const promise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.type = 'text/javascript';
        Object.entries(attributes).forEach(([attr, value]) => {
            if (value != null) {
                script.setAttribute(attr, value);
            }
        });
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script ${url}`));
        document.head.appendChild(script);
    }).catch(error => {
        scriptRegistry.delete(key);
        throw error;
    });

    scriptRegistry.set(key, promise);
    return promise;
}
