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

let openCvReadyPromise = null;
const defaultOpenCvScript = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.9.0-wasm/opencv.js';
const defaultTfjsBackendScript = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.16.0/wasm-out/tfjs-backend-wasm.js';
const tfBackendFallbackKey = 'tfjs-backend-wasm';

installTensorflowBackendRecovery();

export function resetOcrEngine() {
    const preferred = resolvePreferredEngine();
    ocrConfig.engine = preferred;
    ocrConfig.currentEngine = preferred;
}

async function ensureOpenCVReady() {
    if (typeof window === 'undefined') {
        throw new Error('OpenCV preprocessing requires a browser environment.');
    }

    if (window.cv && typeof window.cv.Mat === 'function') {
        return window.cv;
    }

    if (!openCvReadyPromise) {
        openCvReadyPromise = (async () => {
            const scriptUrl = (typeof window !== 'undefined' &&
                window.__OCR_ASSETS__ &&
                typeof window.__OCR_ASSETS__.opencvScript === 'string'
                    ? window.__OCR_ASSETS__.opencvScript
                    : defaultOpenCvScript);
            await loadScriptOnce('opencv', scriptUrl, { crossOrigin: 'anonymous' });
            await waitForOpenCVRuntime();
            return window.cv;
        })().catch(error => {
            openCvReadyPromise = null;
            throw error;
        });
    }

    await openCvReadyPromise;
    return window.cv;
}

function waitForOpenCVRuntime() {
    if (window.cv && typeof window.cv.Mat === 'function') {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 200;

        const check = () => {
            if (window.cv && typeof window.cv.Mat === 'function') {
                resolve();
                return;
            }

            attempts += 1;
            if (attempts > maxAttempts) {
                reject(new Error('OpenCV runtime failed to initialize in time.'));
                return;
            }

            window.setTimeout(check, 25);
        };

        check();
    });
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
        ensureOpenCVReady(),
        loadScriptOnce('ort', 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/ort.min.js', { crossOrigin: 'anonymous' })
    ]);

    await Promise.all([
        fetchModelBuffer('detector', ppocrModelManifest.detector),
        fetchModelBuffer('recognizer', ppocrModelManifest.recognizer),
        fetchModelBuffer('dictionary', ppocrModelManifest.dictionary)
    ]);

    ppocrInitialized = true;
}

export async function runOCREngine(imageInput, label, progressCallback) {
    const variants = normalizePreprocessedVariants(imageInput);
    let bestResult = null;

    const share = 100 / variants.length;

    for (let index = 0; index < variants.length; index += 1) {
        const variant = variants[index];
        const base = share * index;

        if (progressCallback) {
            progressCallback(Math.round(base));
        }

        const variantProgress = progressCallback
            ? percentage => {
                  const adjusted = Math.min(100, Math.round(base + (percentage / 100) * share));
                  progressCallback(adjusted);
              }
            : undefined;

        const recognition = await recognizeWithConfiguredEngines(variant.dataUrl, label, variantProgress);

        if (progressCallback) {
            progressCallback(Math.round(Math.min(100, base + share)));
        }

        const candidate = { ...recognition, variantType: variant.type };

        if (!bestResult || (candidate.confidence || 0) > (bestResult.confidence || 0)) {
            bestResult = candidate;
        }
    }

    return bestResult || { text: '', confidence: 0, engineUsed: ocrConfig.currentEngine, variantType: variants[0]?.type };
}

function normalizePreprocessedVariants(imageInput) {
    const variants = [];

    if (typeof imageInput === 'string') {
        variants.push({ type: 'original', dataUrl: imageInput });
    } else if (imageInput && typeof imageInput === 'object') {
        if (Array.isArray(imageInput.variants)) {
            imageInput.variants.forEach(variant => {
                if (variant && typeof variant.dataUrl === 'string' && variant.dataUrl.length > 0) {
                    variants.push({ type: variant.type || 'variant', dataUrl: variant.dataUrl });
                }
            });
        }

        if (!variants.length) {
            if (typeof imageInput.clean === 'string') {
                variants.push({ type: 'clean', dataUrl: imageInput.clean });
            }
            if (typeof imageInput.thresholded === 'string') {
                variants.push({ type: 'thresholded', dataUrl: imageInput.thresholded });
            }
        }

        if (!variants.length && typeof imageInput.dataUrl === 'string') {
            variants.push({ type: 'processed', dataUrl: imageInput.dataUrl });
        }
    }

    if (!variants.length) {
        throw new Error('No image data provided for OCR.');
    }

    const seen = new Set();
    return variants.filter(variant => {
        if (seen.has(variant.dataUrl)) {
            return false;
        }
        seen.add(variant.dataUrl);
        return true;
    });
}

async function recognizeWithConfiguredEngines(dataUrl, label, progressCallback) {
    const attempted = new Set();
    let engine = ocrConfig.currentEngine;

    while (!attempted.has(engine)) {
        attempted.add(engine);

        if (engine === 'ppocr') {
            try {
                await ensurePPOCREngine();
                const ppocrResult = await runPPOCRInference(dataUrl, progressCallback);
                const confidence = ppocrResult?.confidence || 0;
                if (!ppocrResult?.text || confidence < ocrConfig.confidenceThreshold * 100) {
                    throw new Error('PP-OCR confidence below threshold');
                }
                return { ...ppocrResult, engineUsed: 'ppocr' };
            } catch (error) {
                console.warn(`PP-OCR failed for ${label || 'image'}, switching to fallback.`, error);
                engine = ocrConfig.fallbackEngine;
                ocrConfig.currentEngine = engine;
            }
        } else {
            const result = await recognizeWithTesseract(dataUrl, progressCallback);
            return { ...result, engineUsed: 'tesseract' };
        }
    }

    const fallbackResult = await recognizeWithTesseract(dataUrl, progressCallback);
    ocrConfig.currentEngine = 'tesseract';
    return { ...fallbackResult, engineUsed: 'tesseract' };
}

async function recognizeWithTesseract(dataUrl, progressCallback) {
    await ensureTesseract();

    const result = await window.Tesseract.recognize(dataUrl, 'eng', {
        logger: message => {
            if (progressCallback && message.status === 'recognizing text') {
                const percentage = Math.round((message.progress || 0) * 100);
                progressCallback(percentage);
            }
        }
    });

    return {
        text: result.data?.text || '',
        confidence: result.data?.confidence || 0
    };
}

export async function preprocessImage(dataUrl) {
    try {
        const cv = await ensureOpenCVReady();
        return await preprocessWithOpenCV(cv, dataUrl);
    } catch (error) {
        console.warn('Falling back to canvas preprocessing because OpenCV is unavailable.', error);
        return preprocessWithCanvas(dataUrl);
    }
}

async function preprocessWithOpenCV(cv, dataUrl) {
    const imageElement = await loadImageElement(dataUrl);
    const src = cv.imread(imageElement);
    let warpedResult = null;

    try {
        const region = detectCardRegion(cv, src);
        warpedResult = warpCardToTopDown(cv, src, region.points);
        const variants = generateNormalizedVariants(cv, warpedResult.warped);

        const meta = {
            crop: region.points,
            orderedCrop: warpedResult.ordered,
            size: { width: warpedResult.targetWidth, height: warpedResult.targetHeight }
        };

        if (warpedResult && warpedResult.warped) {
            warpedResult.warped.delete();
            warpedResult.warped = null;
        }

        return createPreprocessResult(variants.cleanDataUrl, variants.thresholdDataUrl, meta);
    } finally {
        if (warpedResult && warpedResult.warped) {
            warpedResult.warped.delete();
        }
        src.delete();
    }
}

async function preprocessWithCanvas(dataUrl) {
    const image = await loadImageElement(dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const grayscaleValues = new Float32Array((imageData.data.length / 4) | 0);
    const { data } = imageData;

    for (let i = 0, pixel = 0; i < data.length; i += 4, pixel += 1) {
        const grayscale = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        grayscaleValues[pixel] = grayscale;
        data[i] = data[i + 1] = data[i + 2] = grayscale;
    }

    context.putImageData(imageData, 0, 0);
    const cleanDataUrl = canvas.toDataURL('image/png');

    const thresholdCanvas = document.createElement('canvas');
    thresholdCanvas.width = canvas.width;
    thresholdCanvas.height = canvas.height;
    const thresholdContext = thresholdCanvas.getContext('2d');
    const thresholdData = thresholdContext.createImageData(thresholdCanvas.width, thresholdCanvas.height);
    const thresholdBuffer = thresholdData.data;

    const { mean, stddev } = computeValueStats(grayscaleValues);
    const adaptiveThreshold = Math.max(60, Math.min(200, mean - stddev * 0.3));

    for (let i = 0, pixel = 0; i < thresholdBuffer.length; i += 4, pixel += 1) {
        const value = grayscaleValues[pixel] > adaptiveThreshold ? 255 : 0;
        thresholdBuffer[i] = thresholdBuffer[i + 1] = thresholdBuffer[i + 2] = value;
        thresholdBuffer[i + 3] = 255;
    }

    thresholdContext.putImageData(thresholdData, 0, 0);
    const thresholdedDataUrl = thresholdCanvas.toDataURL('image/png');

    return createPreprocessResult(cleanDataUrl, thresholdedDataUrl, {
        fallback: true,
        size: { width: canvas.width, height: canvas.height }
    });
}

function detectCardRegion(cv, src) {
    const maxDimension = Math.max(src.cols, src.rows);
    const scale = maxDimension > 800 ? 800 / maxDimension : 1;
    const resizedWidth = Math.max(1, Math.round(src.cols * scale));
    const resizedHeight = Math.max(1, Math.round(src.rows * scale));
    const resizedSize = new cv.Size(resizedWidth, resizedHeight);
    let resized;

    if (scale !== 1) {
        resized = new cv.Mat();
        cv.resize(src, resized, resizedSize, 0, 0, cv.INTER_AREA);
    } else {
        resized = src.clone();
    }

    const gray = new cv.Mat();
    cv.cvtColor(resized, gray, cv.COLOR_RGBA2GRAY, 0);

    const blurred = new cv.Mat();
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

    const edged = new cv.Mat();
    cv.Canny(blurred, edged, 75, 200);

    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(edged, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let bestPoints = null;
    let bestArea = 0;
    const minimumArea = resized.cols * resized.rows * 0.25;

    for (let i = 0; i < contours.size(); i += 1) {
        const contour = contours.get(i);
        const contourArea = cv.contourArea(contour);
        if (contourArea < minimumArea) {
            contour.delete();
            continue;
        }

        const perimeter = cv.arcLength(contour, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);

        if (approx.rows === 4 && contourArea > bestArea) {
            bestArea = contourArea;
            const points = [];
            const data = approx.data32S;
            for (let j = 0; j < data.length; j += 2) {
                points.push({
                    x: data[j] / scale,
                    y: data[j + 1] / scale
                });
            }
            bestPoints = points;
        }

        approx.delete();
        contour.delete();
    }

    hierarchy.delete();
    contours.delete();
    edged.delete();
    blurred.delete();
    gray.delete();
    resized.delete();

    if (bestPoints && bestPoints.length === 4) {
        return { points: bestPoints };
    }

    return {
        points: [
            { x: 0, y: 0 },
            { x: src.cols - 1, y: 0 },
            { x: src.cols - 1, y: src.rows - 1 },
            { x: 0, y: src.rows - 1 }
        ]
    };
}

function warpCardToTopDown(cv, src, points) {
    const { ordered, targetWidth, targetHeight } = computeWarpTargets(points);
    const srcCoordinates = flattenPoints(ordered);
    const dstCoordinates = [
        0, 0,
        targetWidth - 1, 0,
        targetWidth - 1, targetHeight - 1,
        0, targetHeight - 1
    ];

    const srcMat = cv.matFromArray(4, 1, cv.CV_32FC2, srcCoordinates);
    const dstMat = cv.matFromArray(4, 1, cv.CV_32FC2, dstCoordinates);
    const transform = cv.getPerspectiveTransform(srcMat, dstMat);
    const warped = new cv.Mat();

    cv.warpPerspective(src, warped, transform, new cv.Size(targetWidth, targetHeight), cv.INTER_CUBIC, cv.BORDER_REPLICATE);

    srcMat.delete();
    dstMat.delete();
    transform.delete();

    return { warped, ordered, targetWidth, targetHeight };
}

function computeWarpTargets(points) {
    const ordered = orderContourPoints(points);

    const widthA = distanceBetween(ordered[2], ordered[3]);
    const widthB = distanceBetween(ordered[1], ordered[0]);
    const rawWidth = Math.max(widthA, widthB, 1);

    const heightA = distanceBetween(ordered[1], ordered[2]);
    const heightB = distanceBetween(ordered[0], ordered[3]);
    const rawHeight = Math.max(heightA, heightB, 1);

    const preferredWidth = 1400;
    const minWidth = 1050;
    const maxWidth = 1800;

    let targetWidth = rawWidth;
    if (targetWidth < minWidth) {
        targetWidth = minWidth;
    }
    if (targetWidth < preferredWidth) {
        targetWidth = preferredWidth;
    }
    if (targetWidth > maxWidth) {
        targetWidth = maxWidth;
    }

    const scale = targetWidth / rawWidth;
    let targetHeight = Math.round(rawHeight * scale);

    const minHeight = 600;
    const maxHeight = 1200;
    if (targetHeight < minHeight) {
        targetHeight = minHeight;
    }
    if (targetHeight > maxHeight) {
        targetHeight = maxHeight;
    }

    return { ordered, targetWidth: Math.round(targetWidth), targetHeight };
}

function orderContourPoints(points) {
    const sumSorted = [...points].sort((a, b) => a.x + a.y - (b.x + b.y));
    const diffSorted = [...points].sort((a, b) => a.y - a.x - (b.y - b.x));

    const topLeft = sumSorted[0];
    const bottomRight = sumSorted[sumSorted.length - 1];
    const topRight = diffSorted[0];
    const bottomLeft = diffSorted[diffSorted.length - 1];

    return [topLeft, topRight, bottomRight, bottomLeft];
}

function distanceBetween(pointA, pointB) {
    return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
}

function flattenPoints(points) {
    const coordinates = [];
    points.forEach(point => {
        coordinates.push(point.x, point.y);
    });
    return coordinates;
}

function generateNormalizedVariants(cv, warped) {
    const gray = new cv.Mat();
    cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY, 0);

    const denoised = new cv.Mat();
    cv.bilateralFilter(gray, denoised, 9, 75, 75);

    const claheMat = new cv.Mat();
    const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
    clahe.apply(denoised, claheMat);
    clahe.delete();

    const smoothed = new cv.Mat();
    cv.medianBlur(claheMat, smoothed, 3);

    const cleanDataUrl = matToDataUrl(cv, smoothed);

    const thresholdMat = new cv.Mat();
    cv.adaptiveThreshold(smoothed, thresholdMat, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, 10);
    const thresholdDataUrl = matToDataUrl(cv, thresholdMat);

    gray.delete();
    denoised.delete();
    claheMat.delete();
    thresholdMat.delete();
    smoothed.delete();

    return { cleanDataUrl, thresholdDataUrl };
}

function createPreprocessResult(cleanDataUrl, thresholdDataUrl, meta = {}) {
    const variants = [];

    if (cleanDataUrl) {
        variants.push({ type: 'clean', dataUrl: cleanDataUrl });
    }
    if (thresholdDataUrl && thresholdDataUrl !== cleanDataUrl) {
        variants.push({ type: 'thresholded', dataUrl: thresholdDataUrl });
    }

    if (!variants.length && cleanDataUrl) {
        variants.push({ type: 'processed', dataUrl: cleanDataUrl });
    }

    return {
        clean: cleanDataUrl,
        thresholded: thresholdDataUrl,
        defaultVariant: variants[0]?.type || 'clean',
        variants,
        meta
    };
}

function loadImageElement(dataUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = dataUrl;
    });
}

function matToDataUrl(cv, mat) {
    const canvas = document.createElement('canvas');
    cv.imshow(canvas, mat);
    return canvas.toDataURL('image/png');
}

function computeValueStats(values) {
    let sum = 0;
    let sumSquares = 0;

    for (let i = 0; i < values.length; i += 1) {
        const value = values[i];
        sum += value;
        sumSquares += value * value;
    }

    const mean = values.length ? sum / values.length : 0;
    const variance = values.length ? Math.max(0, sumSquares / values.length - mean * mean) : 0;

    return { mean, stddev: Math.sqrt(variance) };
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
        engine: result.engineUsed,
        variant: result.variantUsed || result.variantType || result.preprocessed?.defaultVariant || null
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

function installTensorflowBackendRecovery() {
    if (typeof window === 'undefined') {
        return;
    }

    if (window.__tfBackendRecoveryInstalled) {
        return;
    }

    window.__tfBackendRecoveryInstalled = true;

    window.addEventListener(
        'error',
        event => {
            const target = event?.target;
            if (!shouldHandleTensorflowScriptError(target)) {
                return;
            }

            if (typeof event.preventDefault === 'function') {
                event.preventDefault();
            }
            if (typeof event.stopPropagation === 'function') {
                event.stopPropagation();
            }
            if (typeof event.stopImmediatePropagation === 'function') {
                event.stopImmediatePropagation();
            }

            const failingSrc = target?.src || '';
            const fallbackUrl = resolveTensorflowBackendUrl(failingSrc);

            if (!fallbackUrl || fallbackUrl === failingSrc) {
                return;
            }

            if (target?.parentNode && typeof target.parentNode.removeChild === 'function') {
                target.parentNode.removeChild(target);
            }

            console.warn(
                `TensorFlow WASM backend not found at ${failingSrc}. Retrying with ${fallbackUrl}.`
            );

            loadScriptOnce(tfBackendFallbackKey, fallbackUrl, { crossOrigin: 'anonymous' }).catch(error => {
                console.error(`Failed to recover TensorFlow WASM backend from ${fallbackUrl}`, error);
            });
        },
        true
    );
}

function shouldHandleTensorflowScriptError(target) {
    if (!target || target.tagName !== 'SCRIPT') {
        return false;
    }
    const src = target.src || '';
    if (!src) {
        return false;
    }
    if (src.includes('/wasm-out/')) {
        return false;
    }
    return src.includes('@tensorflow/tfjs-backend-wasm');
}

function resolveTensorflowBackendUrl(failingSrc) {
    const override = typeof window !== 'undefined' && window.__OCR_ASSETS__
        ? window.__OCR_ASSETS__.tfjsBackendScript
        : null;

    if (typeof override === 'string' && override.trim().length > 0) {
        return override.trim();
    }

    if (typeof failingSrc === 'string' && failingSrc.includes('/dist/')) {
        return failingSrc.replace('/dist/', '/wasm-out/');
    }

    return defaultTfjsBackendScript;
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
