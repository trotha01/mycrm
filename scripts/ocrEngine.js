export const ocrConfig = {
    engine: 'ppocr',
    fallbackEngine: 'tesseract',
    confidenceThreshold: 0.58,
    currentEngine: 'ppocr'
};

const fieldParserScripts = {
    libphonenumber: 'https://cdn.jsdelivr.net/npm/libphonenumber-js@1.10.25/bundle/libphonenumber-js.min.js',
    humanparser: 'https://cdn.jsdelivr.net/npm/humanparser@2.2.7/humanparser.min.js',
    parseAddress: 'https://cdn.jsdelivr.net/npm/parse-address@1.0.4/parse-address.min.js'
};

const scriptRegistry = new Map();
const ocrModelBuffers = {};
const ppocrModelManifest = {
    detector: 'https://cdn.jsdelivr.net/gh/PaddlePaddle/PaddleOCR@release/2.6/inference/en/en_ppocr_mobile_v2.0_det_infer.onnx',
    recognizer: 'https://cdn.jsdelivr.net/gh/PaddlePaddle/PaddleOCR@release/2.6/inference/en/en_ppocr_mobile_v2.0_rec_infer.onnx',
    dictionary: 'https://cdn.jsdelivr.net/gh/PaddlePaddle/PaddleOCR@release/2.6/ppocr/utils/ppocr_keys_v1.txt'
};

let ppocrInitialized = false;

export function resetOcrEngine() {
    ocrConfig.currentEngine = ocrConfig.engine;
}

export async function ensureFieldParsers() {
    const loaders = Object.entries(fieldParserScripts).map(async ([key, url]) => {
        try {
            await loadScriptOnce(key, url, { crossOrigin: 'anonymous' });
        } catch (error) {
            console.warn(`Failed to load ${key} parser`, error);
        }
    });
    await Promise.all(loaders);
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

async function ensurePPOCREngine() {
    if (ppocrInitialized) {
        return;
    }

    await Promise.all([
        loadScriptOnce('opencv', 'https://cdn.jsdelivr.net/npm/opencv.js@4.8.0/opencv.js', { crossOrigin: 'anonymous' }),
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

    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi;
    const emailMatch = fullText.match(emailRegex);
    if (emailMatch && emailMatch.length > 0) {
        info.email = emailMatch[0].toLowerCase();
    }

    const phoneParser = window.libphonenumber?.parsePhoneNumberFromString;
    if (phoneParser) {
        for (const line of lines) {
            const parsed = phoneParser(line, 'US');
            if (parsed && parsed.isValid()) {
                info.phone = parsed.formatInternational();
                break;
            }
        }
    }

    if (!info.phone) {
        const fallbackLine = lines.find(line => /\d{3}[)\s.-]*\d{3}[\s.-]*\d{4}/.test(line));
        if (fallbackLine) {
            const match = fallbackLine.match(/\+?\d[\d\s().-]{7,}/);
            if (match) {
                info.phone = match[0];
            }
        }
    }

    const titleKeywords = ['ceo', 'cto', 'cfo', 'president', 'director', 'manager', 'lead', 'senior', 'junior', 'associate', 'consultant', 'analyst', 'specialist', 'coordinator', 'supervisor', 'executive', 'officer', 'founder'];
    const companyKeywords = ['inc', 'llc', 'corp', 'company', 'ltd', 'limited', 'corporation', 'group', 'solutions', 'services', 'consulting', 'partners', 'associates', 'studio', 'labs'];

    const nameParser = window.humanparser?.parseName;
    for (const line of lines) {
        const lower = line.toLowerCase();
        if (info.email && line.includes(info.email)) continue;
        if (info.phone && line.includes(info.phone.replace(/[^\d]/g, ''))) continue;

        if (!info.title && titleKeywords.some(keyword => lower.includes(keyword))) {
            info.title = line;
            continue;
        }

        if (!info.company && companyKeywords.some(keyword => lower.includes(keyword))) {
            info.company = line;
            continue;
        }

        if (!info.name && nameParser) {
            const parsedName = nameParser(line);
            if (parsedName && parsedName.firstName && parsedName.lastName) {
                const parts = [parsedName.firstName, parsedName.middleName, parsedName.lastName]
                    .filter(Boolean)
                    .join(' ')
                    .trim();
                if (parts.length > 0) {
                    info.name = parts;
                    continue;
                }
            }
        }

        if (!info.name && /^[A-Za-z]+(?:\s[A-Za-z.'-]+){1,3}$/.test(line)) {
            info.name = line;
        }
    }

    if (!info.company) {
        const fallbackCompany = lines.find(line => !line.includes(info.name) && !line.includes(info.email) && !/\d/.test(line) && line.length > 3);
        if (fallbackCompany) {
            info.company = fallbackCompany;
        }
    }

    if (!info.name && info.email) {
        const emailPrefix = info.email.split('@')[0].replace(/[._]/g, ' ');
        info.name = emailPrefix.split(' ').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
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
