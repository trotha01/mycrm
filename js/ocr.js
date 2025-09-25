(function() {
/**
     * Module Overview — OCR Text Extractor (Front‑End Only)
     *
     * Purpose
     * - Let a user upload a business card image, crop/deskew it client‑side, run Tesseract.js OCR, and extract structured fields (name, email, phone).
     *
     * Inputs / Outputs
     * - Input: An HTMLImageElement loaded from <input type="file"> plus UI adjustments (crop %, rotation).
     * - Output: UI renders a preprocessed canvas preview, raw OCR text, and a structured JSON object ({ name, email, phone, debug }).
     *
     * Constraints
     * - Browser‑only; no network I/O beyond loading Tesseract assets.
     * - Maintain SPA responsiveness; avoid blocking the main thread by leveraging Tesseract worker.
     * - Keep memory modest; scale images to a sane width (>= 1800px) before heavy processing.
     *
     * Edge Cases
     * - Skewed photos, borders/backgrounds, noisy lighting, non‑English characters.
     * - Email split across tokens; visually similar glyph confusions (O/0, I/1, S/5, etc.).
     *
     * Examples
     * - Given a 3024×4032 phone photo: crop, rotate ~‑2.4°, scale to 2200px width, binarize, auto‑crop, then run OCR.
     *
     * Do Not
     * - Do not change public behavior (exporting window.extractCardData, UI IDs).
     * - Do not transmit images or PII off device.
     * - Do not add external deps; this module is self‑contained aside from Tesseract.js.
     */
        const DEFAULT_TARGET_WIDTH = 2400;
        const REQUIRED_WARNINGS = [/Image too small to scale!!/i, /Line cannot be recognized!!/i];
        const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
        const PHONE_REGEX = /(\+\d{1,3}\s*)?[\d() -]{7,}/;
        /**
         * Purpose: Normalize a noisy email candidate string produced by OCR.
         * Inputs: str (string) — raw token(s) around an email.
         * Outputs: lower‑cased string with spaces removed and common OCR glyph confusions corrected.
         * Constraints: Pure; does not validate the email, only sanitizes for downstream regex.
         * Edge Cases: Handles unicode bullets/dots, full‑width '@', and repeated dots.
         */
        function normalizeEmailCandidate(str) {
            if (!str) return '';
            let s = String(str).replace(/\s+/g, '');
            // punctuation normalizations
            s = s.replace(/[\u2019\u2018`]/g, "'").replace(/[\u00B7\u2022]/g, '.').replace(/\uFF20/g, '@');
            // common OCR confusions
            const map = { 'O': 'o', 'I': 'l', 'S': 's', 'B': 'b', 'Z': 'z', '0': 'o', '1': 'l', '5': 's' };
            s = s.split('').map(ch => map[ch] || ch).join('');
            // collapse multiple dots
            s = s.replace(/\.{2,}/g, '.');
            // drop any characters not part of the email token alphabet (prevents stray '(' etc.)
            s = s.replace(/[^A-Za-z0-9._%+@-]/g, '');
            return s.toLowerCase();
        }
        const EXTRA_LANGUAGE_MAP = [
            { lang: 'pol', pattern: /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/ },
            { lang: 'deu', pattern: /[äöüßÄÖÜẞ]/ },
            { lang: 'fra', pattern: /[àâæçéèêëîïôœùûüÿÀÂÆÇÉÈÊËÎÏÔŒÙÛÜŸ]/ },
            { lang: 'spa', pattern: /[áéíóúñüÁÉÍÓÚÑÜ]/ }
        ];

        const state = {
            image: null,
            objectUrl: null,
            adjustments: {
                cropTop: 5,
                cropBottom: 5,
                cropLeft: 5,
                cropRight: 5,
                rotation: 0
            },
            previewCanvas: null,
            workerPromise: null,
            worker: null,
            loadedLanguages: ['eng']
        };

        const imageInput = document.getElementById('imageInput');
        const originalPreview = document.getElementById('originalPreview');
        const processedPreview = document.getElementById('processedPreview');
        const otsuPreview = document.getElementById('otsuPreview');
        const sauvolaPreview = document.getElementById('sauvolaPreview');
        const finalPreview = document.getElementById('finalPreview');
        const processBtn = document.getElementById('processBtn');
        const statusText = document.getElementById('statusText');
        const progressBar = document.getElementById('progress');
        const rawOutput = document.getElementById('rawOutput');
        const jsonOutput = document.getElementById('jsonOutput');
        const fieldSummary = document.getElementById('fieldSummary');
        const retryLog = document.getElementById('retryLog');

        const controls = [
            { id: 'cropTop', key: 'cropTop', output: 'cropTopValue', suffix: '%' },
            { id: 'cropBottom', key: 'cropBottom', output: 'cropBottomValue', suffix: '%' },
            { id: 'cropLeft', key: 'cropLeft', output: 'cropLeftValue', suffix: '%' },
            { id: 'cropRight', key: 'cropRight', output: 'cropRightValue', suffix: '%' },
            { id: 'rotation', key: 'rotation', output: 'rotationValue', suffix: '°' }
        ];

        controls.forEach(({ id, key, output, suffix }) => {
            const input = document.getElementById(id);
            const out = document.getElementById(output);
            if (!input || !out) {
                return;
            }
            input.addEventListener('input', () => {
                let value = parseFloat(input.value);
                if (key !== 'rotation') {
                    value = Math.min(40, Math.max(0, value));
                    out.textContent = value.toFixed(0) + suffix;
                } else {
                    value = Math.max(-15, Math.min(15, value));
                    out.textContent = value.toFixed(1) + suffix;
                }
                state.adjustments[key] = value;
                schedulePreviewUpdate();
            });
        });

        let previewRaf = null;
        function schedulePreviewUpdate() {
            if (!state.image) return;
            if (previewRaf) cancelAnimationFrame(previewRaf);
            previewRaf = requestAnimationFrame(async () => {
                previewRaf = null;
                await updatePreview();
            });
        }

        if (imageInput) {
        imageInput.addEventListener('change', () => {
            const [file] = imageInput.files || [];
            if (rawOutput) rawOutput.value = '';
            if (jsonOutput) jsonOutput.value = '';
            if (fieldSummary) fieldSummary.innerHTML = '';
            if (retryLog) retryLog.innerHTML = '';
            if (progressBar) progressBar.style.width = '0%';
            if (statusText) statusText.textContent = file ? 'Preparing preview…' : 'Select an image to begin.';
            if (processBtn) processBtn.disabled = !file;

            if (state.objectUrl) {
                URL.revokeObjectURL(state.objectUrl);
                state.objectUrl = null;
            }

            if (!file) {
                if (originalPreview) originalPreview.removeAttribute('src');
                if (processedPreview) {
                    processedPreview.width = 0;
                    processedPreview.height = 0;
                }
                state.image = null;
                return;
            }

            const url = URL.createObjectURL(file);
            state.objectUrl = url;
            const img = new Image();
            img.onload = () => {
                state.image = img;
                if (originalPreview) originalPreview.src = url;
                schedulePreviewUpdate();
            };
            img.onerror = () => {
                if (statusText) statusText.textContent = 'Unable to load that image. Try another file.';
                if (processBtn) processBtn.disabled = true;
            };
            img.src = url;
        });
        }

        /**
         * Purpose: Lazily create and initialize a singleton Tesseract worker.
         * Notes: Retains loaded languages across attempts to avoid re‑init cost.
         */
        async function ensureWorker() {
            if (state.worker) return state.worker;
            if (!state.workerPromise) {
                const { createWorker } = Tesseract;
                state.workerPromise = (async () => {
                    const worker = await createWorker({
                        logger: (message) => handleWorkerLog(message)
                    });
                    await worker.load();
                    await worker.loadLanguage('eng');
                    await worker.initialize('eng');
                    state.loadedLanguages = ['eng'];
                    state.worker = worker;
                    return worker;
                })();
            }
            return state.workerPromise;
        }

        let recognitionContext = null;
        /**
         * Purpose: Route Tesseract progress messages into the UI with a scoped label and progress span.
         */
        function handleWorkerLog(message) {
            if (!recognitionContext) return;
            const summary = formatLog(message);
            recognitionContext.logs.push(summary);
            if (message.status === 'recognizing text' && typeof message.progress === 'number') {
                const start = recognitionContext.progressRange[0];
                const end = recognitionContext.progressRange[1];
                const pct = Math.round(start + (end - start) * message.progress);
                updateProgress(pct, `${recognitionContext.label}: ${Math.round(message.progress * 100)}%`);
            } else if (message.status) {
                updateStatus(`${recognitionContext.label}: ${message.status.replace(/_/g, ' ')}`);
            }
        }

        /** UI helper: set status text. */
        function updateStatus(text) {
            if (statusText) {
                statusText.textContent = text;
            }
        }

        /** UI helper: advance progress bar and (optionally) set status text. */
        function updateProgress(percent, text) {
            if (progressBar) {
                progressBar.style.width = `${percent}%`;
            }
            if (text && statusText) {
                statusText.textContent = text;
            }
        }

        /**
         * Purpose: Recompute the preprocessed preview after crop/rotation changes.
         */
        async function updatePreview() {
            if (!state.image) return;
            const {canvas}  = preprocessImage(state.image, state.adjustments, { targetWidth: DEFAULT_TARGET_WIDTH });
            if (canvas) {
                drawIntoCanvas(finalPreview, canvas); // cleaned + cropped result used for OCR
            }
        }

        /** UI helper: draw a canvas into the preview element. */
        function drawToPreview(canvas) {
            if (!processedPreview) return;
            processedPreview.width = canvas.width;
            processedPreview.height = canvas.height;
            const ctx = processedPreview.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(canvas, 0, 0);
        }

        // Generic: Copy contents of one canvas into another
        function drawIntoCanvas(targetCanvas, sourceCanvas) {
            if (!targetCanvas || !sourceCanvas) return;
            targetCanvas.width = sourceCanvas.width;
            targetCanvas.height = sourceCanvas.height;
            const tctx = targetCanvas.getContext('2d');
            tctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
            tctx.drawImage(sourceCanvas, 0, 0);
        }

        // Helper: Convert a binary mask (Uint8ClampedArray) to a canvas for preview
        function makeCanvasFromBinary(binary, width, height) {
            const c = document.createElement('canvas');
            c.width = width; c.height = height;
            const ctx = c.getContext('2d');
            const img = ctx.createImageData(width, height);
            for (let i = 0, j = 0; i < img.data.length; i += 4, j++) {
                const v = binary[j];
                img.data[i] = v;
                img.data[i + 1] = v;
                img.data[i + 2] = v;
                img.data[i + 3] = 255;
            }
            ctx.putImageData(img, 0, 0);
            return c;
        }

        /**
         * Purpose: Transform the source image into an OCR‑friendly binary canvas.
         * Inputs
         *   - image: HTMLImageElement
         *   - adjustments: { cropTop, cropBottom, cropLeft, cropRight, rotation } in percent/deg
         *   - options.targetWidth?: desired working width (>= 1800)
         * Outputs: { canvas, steps, threshold }
         *   - canvas: preprocessed image
         *   - steps: pipeline markers for debug
         *   - threshold: global Otsu cutoff used before morphology
         * Constraints
         *   - CPU‑only; use small kernels (3×3) and single‑channel ops for speed.
         *   - Keep aspect ratio; upscale via high quality interpolation.
         * Edge Cases
         *   - If auto‑crop finds no content box, returns the scaled canvas as‑is.
         */
        function preprocessImage(image, adjustments, options = {}) {
            const steps = [];
            const targetWidth = Math.max(1800, options.targetWidth || DEFAULT_TARGET_WIDTH);
            const naturalWidth = image.naturalWidth || image.width;
            const naturalHeight = image.naturalHeight || image.height;

            const baseCanvas = document.createElement('canvas');
            baseCanvas.width = naturalWidth;
            baseCanvas.height = naturalHeight;
            baseCanvas.getContext('2d').drawImage(image, 0, 0);

            const crop = {
                top: Math.min(Math.max(adjustments.cropTop || 0, 0), 40) / 100,
                bottom: Math.min(Math.max(adjustments.cropBottom || 0, 0), 40) / 100,
                left: Math.min(Math.max(adjustments.cropLeft || 0, 0), 40) / 100,
                right: Math.min(Math.max(adjustments.cropRight || 0, 0), 40) / 100
            };

            const cropRect = {
                x: Math.round(naturalWidth * crop.left),
                y: Math.round(naturalHeight * crop.top),
                width: Math.round(naturalWidth * (1 - crop.left - crop.right)),
                height: Math.round(naturalHeight * (1 - crop.top - crop.bottom))
            };

            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = cropRect.width;
            cropCanvas.height = cropRect.height;
            cropCanvas.getContext('2d').drawImage(
                baseCanvas,
                cropRect.x,
                cropRect.y,
                cropRect.width,
                cropRect.height,
                0,
                0,
                cropRect.width,
                cropRect.height
            );
            steps.push('crop');

            const rotation = (adjustments.rotation || 0) * Math.PI / 180;
            const absRotation = Math.abs(rotation);
            const rotatedWidth = Math.round(cropCanvas.width * Math.cos(absRotation) + cropCanvas.height * Math.sin(absRotation));
            const rotatedHeight = Math.round(cropCanvas.width * Math.sin(absRotation) + cropCanvas.height * Math.cos(absRotation));
            const rotatedCanvas = document.createElement('canvas');
            rotatedCanvas.width = rotatedWidth;
            rotatedCanvas.height = rotatedHeight;
            const rotatedCtx = rotatedCanvas.getContext('2d');
            rotatedCtx.translate(rotatedWidth / 2, rotatedHeight / 2);
            rotatedCtx.rotate(rotation);
            rotatedCtx.drawImage(cropCanvas, -cropCanvas.width / 2, -cropCanvas.height / 2);
            steps.push(`deskew-${(adjustments.rotation || 0).toFixed(1)}deg`);

            const scale = targetWidth / rotatedCanvas.width;
            const scaledWidth = Math.round(targetWidth);
            const scaledHeight = Math.round(rotatedCanvas.height * scale);
            const scaledCanvas = document.createElement('canvas');
            scaledCanvas.width = scaledWidth;
            scaledCanvas.height = scaledHeight;
            const scaledCtx = scaledCanvas.getContext('2d');
            scaledCtx.imageSmoothingQuality = 'high';
            scaledCtx.drawImage(rotatedCanvas, 0, 0, scaledWidth, scaledHeight);
            steps.push(`scale-${scaledWidth}`);

            const ctx = scaledCanvas.getContext('2d');
            const { width, height } = scaledCanvas;
            const imageData = ctx.getImageData(0, 0, width, height);
            const gray = new Uint8ClampedArray(width * height);

            for (let i = 0, j = 0; i < imageData.data.length; i += 4, j += 1) {
                const r = imageData.data[i];
                const g = imageData.data[i + 1];
                const b = imageData.data[i + 2];
                gray[j] = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
            }
            steps.push('grayscale');

            // Boost contrast to make strokes crisper
            const stretched = contrastStretch(gray, width, height, 1, 99);
            steps.push('contrast-stretch-1-99');

            // Light denoise
            const denoised = convolveGray(stretched, width, height, [
                1, 2, 1,
                2, 4, 2,
                1, 2, 1
            ], 16);
            steps.push('gaussian-blur-3x3');

            // --- Dual binarization ---
            // 1) Otsu (global) — robust for margins and straight borders
            const otsuT = otsuThreshold(denoised);
            const otsuBinary = new Uint8ClampedArray(width * height);
            for (let i = 0; i < denoised.length; i++) otsuBinary[i] = denoised[i] > otsuT ? 255 : 0;
            steps.push(`otsu-${otsuT}`);

            // 2) Sauvola (local) — preserves thin glyphs like '@'
            const sauvolaBinary = sauvolaBinarize(denoised, width, height, 33, 0.32, 128);
            steps.push('sauvola-33-k0.32');

            // 3) Combine (union): black if black in *either* mask
            const combinedBinary = binaryUnion(otsuBinary, sauvolaBinary);
            steps.push('union-otsu|sauvola');

            // --- Clean up combined mask for OCR rendering ---
            const opened = morphologyOpen(combinedBinary, width, height);
            steps.push('morph-open');
            const majority = binaryMajority3x3(opened, width, height);
            steps.push('majority-3x3');
            const sharpened = applyUnsharpBinary(majority, width, height, 0.25);
            steps.push('sharpen-0.25');

            // Draw combined (cleaned) result for preview/next stages
            const finalData = ctx.createImageData(width, height);
            for (let i = 0, j = 0; i < finalData.data.length; i += 4, j += 1) {
              const value = sharpened[j];
              finalData.data[i] = value;
              finalData.data[i + 1] = value;
              finalData.data[i + 2] = value;
              finalData.data[i + 3] = 255;
            }
            ctx.putImageData(finalData, 0, 0);

            // --- Auto-crop using Otsu (more stable for borders) ---
            let outCanvas = scaledCanvas;
            const otsuForCropOpen = morphologyOpen(otsuBinary, width, height);
            const otsuForCrop = morphologyCloseK(otsuForCropOpen, width, height, 5);
            const box = computeAutoCropBoxCC(otsuForCrop, width, height) ||
                        computeAutoCropBoxSmart(otsuForCrop, width, height) ||
                        computeAutoCropBox(otsuForCrop, width, height, { minFrac: 0.35, minRun: 10, pad: 8 });
            if (box) {
              const autoCanvas = document.createElement('canvas');
              autoCanvas.width = box.w;
              autoCanvas.height = box.h;
              autoCanvas.getContext('2d').drawImage(
                  scaledCanvas, box.x, box.y, box.w, box.h,
                  0, 0, box.w, box.h
              );
              outCanvas = autoCanvas;
              steps.push(`auto-crop-otsu-${box.w}x${box.h}`);
            }

            return {
              canvas: outCanvas,
              steps,
              threshold: otsuT,
            };
        }

        /**
        * Binary union: keep black (0) where *either* mask is black. Else 255.
        */
        function binaryUnion(a, b) {
            const n = Math.min(a.length, b.length);
            const out = new Uint8ClampedArray(n);
            for (let i = 0; i < n; i++) {
                out[i] = (a[i] === 0 || b[i] === 0) ? 0 : 255;
            }
            return out;
        }

        /**
         * Purpose: Apply a small convolution to a single‑channel image.
         * Inputs: Uint8ClampedArray input, dimensions, flat kernel[], and divisor.
         * Output: Uint8ClampedArray (same dimensions).
         * Notes: Edges are handled by clamping coordinates (replicate border).
         */
        function convolveGray(input, width, height, kernel, divisor) {
            const output = new Uint8ClampedArray(input.length);
            const kSize = Math.sqrt(kernel.length);
            const kOffset = Math.floor(kSize / 2);
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    let acc = 0;
                    for (let ky = -kOffset; ky <= kOffset; ky++) {
                        for (let kx = -kOffset; kx <= kOffset; kx++) {
                            const px = Math.min(width - 1, Math.max(0, x + kx));
                            const py = Math.min(height - 1, Math.max(0, y + ky));
                            const weight = kernel[(ky + kOffset) * kSize + (kx + kOffset)];
                            acc += input[py * width + px] * weight;
                        }
                    }
                    output[y * width + x] = Math.min(255, Math.max(0, Math.round(acc / divisor)));
                }
            }
            return output;
        }

        /**
         * Linear contrast stretch using low/high percentiles to boost stroke contrast.
         */
        function contrastStretch(gray, width, height, lowPct = 1, highPct = 99) {
          const total = gray.length;
          const hist = new Uint32Array(256);
          for (let i = 0; i < total; i++) hist[gray[i]]++;
          const lowCount = Math.floor((lowPct / 100) * total);
          const highCount = Math.floor((highPct / 100) * total);
          let acc = 0, lo = 0, hi = 255;
          for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= lowCount) { lo = i; break; } }
          acc = 0;
          for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= (total - highCount)) { hi = i; break; } }
          if (hi <= lo) return gray.slice();
          const scale = 255 / (hi - lo);
          const out = new Uint8ClampedArray(total);
          for (let i = 0; i < total; i++) {
            const v = gray[i];
            out[i] = v <= lo ? 0 : v >= hi ? 255 : Math.max(0, Math.min(255, Math.round((v - lo) * scale)));
          }
          return out;
        }

            /**
             * Purpose: Light unsharp mask on a binary‑ish image to re‑emphasize strokes.
             * Inputs: binary‑like channel (0/255), width/height, amount factor.
             * Output: New binary channel (0/255) after sharpening.
             * Caution: Aggressive amounts can fatten noise; keep <= 0.6.
             */
            function applyUnsharpBinary(input, width, height, amount = 0.4) {
                const blurred = convolveGray(input, width, height, [
                    1, 2, 1,
                    2, 4, 2,
                    1, 2, 1
                ], 16);
                const output = new Uint8ClampedArray(input.length);
                for (let i = 0; i < input.length; i++) {
                    const sharpened = input[i] + amount * (input[i] - blurred[i]);
                    output[i] = sharpened > 128 ? 255 : 0;
                }
                return output;
            }
            /**
             * Purpose: Precompute summed‑area tables for fast local mean/std.
             * Used by: sauvolaBinarize.
             */
            function computeIntegralImages(gray, width, height) {
                const W = width + 1, H = height + 1;
                const integral = new Float64Array(W * H);
                const integralSq = new Float64Array(W * H);
                for (let y = 1; y < H; y++) {
                    let rowsum = 0, rowsumSq = 0;
                    for (let x = 1; x < W; x++) {
                        const v = gray[(y - 1) * width + (x - 1)];
                        rowsum += v; rowsumSq += v * v;
                        const idx = y * W + x;
                        integral[idx] = integral[idx - W] + rowsum;
                        integralSq[idx] = integralSq[idx - W] + rowsumSq;
                    }
                }
                return { integral, integralSq, W, H };
            }

            /**
             * Purpose: Local (adaptive) thresholding via Sauvola.
             * Inputs: gray channel, window (odd), k (0..1), R reference.
             * Output: Uint8ClampedArray (0/255). Not currently used in main path but kept for experimentation on low‑contrast cards.
             */
            function sauvolaBinarize(gray, width, height, window = 31, k = 0.34, R = 128) {
                const out = new Uint8ClampedArray(gray.length);
                const { integral, integralSq, W, H } = computeIntegralImages(gray, width, height);
                const r = Math.max(1, (window | 0) >> 1);
                for (let y = 0; y < height; y++) {
                    const y0 = Math.max(0, y - r), y1 = Math.min(height - 1, y + r);
                    const iy0 = y0 + 1, iy1 = y1 + 1;
                    for (let x = 0; x < width; x++) {
                        const x0 = Math.max(0, x - r), x1 = Math.min(width - 1, x + r);
                        const ix0 = x0 + 1, ix1 = x1 + 1;

                        const A = integral[iy0 * W + ix0], B = integral[iy0 * W + ix1];
                        const C = integral[iy1 * W + ix0], D = integral[iy1 * W + ix1];
                        const AS = integralSq[iy0 * W + ix0], BS = integralSq[iy0 * W + ix1];
                        const CS = integralSq[iy1 * W + ix0], DS = integralSq[iy1 * W + ix1];

                        const area = (x1 - x0 + 1) * (y1 - y0 + 1);
                        const sum = D - B - C + A;
                        const sumSq = DS - BS - CS + AS;

                        const mean = sum / area;
                        const variance = Math.max(0, (sumSq / area) - mean * mean);
                        const std = Math.sqrt(variance);
                        const thresh = mean * (1 + k * ((std / R) - 1));
                        out[y * width + x] = gray[y * width + x] > thresh ? 255 : 0;
                    }
                }
                return out;
            }

            /**
             * Purpose: Morphological closing (dilate→erode) to reconnect thin strokes like '@'.
             * Inputs/Outputs: binary (0/255). Returns a new Uint8ClampedArray.
             */
            function morphologyClose(binary, width, height) {
                // dilate then erode with 3x3 kernel to reconnect thin '@' parts
                const dilated = new Uint8ClampedArray(binary.length);
                const eroded = new Uint8ClampedArray(binary.length);
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        let max = 0;
                        for (let ky = -1; ky <= 1; ky++) {
                            for (let kx = -1; kx <= 1; kx++) {
                                const px = Math.min(width - 1, Math.max(0, x + kx));
                                const py = Math.min(height - 1, Math.max(0, y + ky));
                                max = Math.max(max, binary[py * width + px]);
                            }
                        }
                        dilated[y * width + x] = max;
                    }
                }
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        let min = 255;
                        for (let ky = -1; ky <= 1; ky++) {
                            for (let kx = -1; kx <= 1; kx++) {
                                const px = Math.min(width - 1, Math.max(0, x + kx));
                                const py = Math.min(height - 1, Math.max(0, y + ky));
                                min = Math.min(min, dilated[py * width + px]);
                            }
                        }
                        eroded[y * width + x] = min;
                    }
                }
                return eroded;
            }

            /**
             * Binary majority filter (3x3). Sets pixel to 255 if >=5 neighbors (incl self) are 255.
             * Smooths jagged cracks without thickening edges too much.
             */
            function binaryMajority3x3(input, width, height) {
              const out = new Uint8ClampedArray(input.length);
              for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                  let sum = 0;
                  for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                      const px = Math.min(width - 1, Math.max(0, x + kx));
                      const py = Math.min(height - 1, Math.max(0, y + ky));
                      sum += input[py * width + px] === 255 ? 1 : 0;
                    }
                  }
                  out[y * width + x] = (sum >= 5) ? 255 : 0;
                }
              }
              return out;
            }

            /**
             * Morphological close with a square k×k kernel (odd k >= 3).
             * Useful for sealing small cracks across letter strokes.
             */
            function morphologyCloseK(binary, width, height, k) {
              const r = Math.max(1, ((k | 0) - 1) >> 1);
              const W = width, H = height;
              const dil = new Uint8ClampedArray(binary.length);
              const ero = new Uint8ClampedArray(binary.length);
              // Dilate
              for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                  let maxv = 0;
                  for (let ky = -r; ky <= r; ky++) {
                    for (let kx = -r; kx <= r; kx++) {
                      const px = Math.min(W - 1, Math.max(0, x + kx));
                      const py = Math.min(H - 1, Math.max(0, y + ky));
                      maxv = Math.max(maxv, binary[py * W + px]);
                    }
                  }
                  dil[y * W + x] = maxv;
                }
              }
              // Erode
              for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                  let minv = 255;
                  for (let ky = -r; ky <= r; ky++) {
                    for (let kx = -r; kx <= r; kx++) {
                      const px = Math.min(W - 1, Math.max(0, x + kx));
                      const py = Math.min(H - 1, Math.max(0, y + ky));
                      minv = Math.min(minv, dil[py * W + px]);
                    }
                  }
                  ero[y * W + x] = minv;
                }
              }
              return ero;
            }

        /**
         * Purpose: Compute global Otsu threshold for a histogram of 0..255 gray levels.
         * Input: Uint8ClampedArray of intensities.
         * Output: Integer threshold [0..255].
         */
        function otsuThreshold(values) {
            const histogram = new Array(256).fill(0);
            values.forEach((v) => histogram[v]++);
            const total = values.length;
            let sum = 0;
            for (let i = 0; i < 256; i++) {
                sum += i * histogram[i];
            }
            let sumB = 0;
            let wB = 0;
            let maximum = 0;
            let threshold = 0;

            for (let i = 0; i < 256; i++) {
                wB += histogram[i];
                if (wB === 0) continue;
                const wF = total - wB;
                if (wF === 0) break;
                sumB += i * histogram[i];
                const mB = sumB / wB;
                const mF = (sum - sumB) / wF;
                const between = wB * wF * (mB - mF) * (mB - mF);
                if (between > maximum) {
                    maximum = between;
                    threshold = i;
                }
            }
            return threshold;
        }

        /**
         * Purpose: Morphological opening (erode→dilate) to remove small specks/noise.
         * Inputs/Outputs: binary (0/255). Returns a new Uint8ClampedArray.
         */
        function morphologyOpen(binary, width, height) {
            const eroded = new Uint8ClampedArray(binary.length);
            const dilated = new Uint8ClampedArray(binary.length);

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    let min = 255;
                    for (let ky = -1; ky <= 1; ky++) {
                        for (let kx = -1; kx <= 1; kx++) {
                            const px = Math.min(width - 1, Math.max(0, x + kx));
                            const py = Math.min(height - 1, Math.max(0, y + ky));
                            min = Math.min(min, binary[py * width + px]);
                        }
                    }
                    eroded[y * width + x] = min;
                }
            }

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    let max = 0;
                    for (let ky = -1; ky <= 1; ky++) {
                        for (let kx = -1; kx <= 1; kx++) {
                            const px = Math.min(width - 1, Math.max(0, x + kx));
                            const py = Math.min(height - 1, Math.max(0, y + ky));
                            max = Math.max(max, eroded[py * width + px]);
                        }
                    }
                    dilated[y * width + x] = max;
                }
            }

            return dilated;
            }

            /**
             * Purpose: Derive a tight content bounding box from a binary mask.
             * Inputs: binary mask, dims, opts { minFrac, minRun, pad }.
             * Output: { x, y, w, h } or null if insufficient content found.
             * Notes: Uses row/column white‑pixel runs to ignore borders/background.
             */
            function computeAutoCropBox(binary, width, height, opts = {}) {
                const minFrac = opts.minFrac ?? 0.35;   // fraction of width/height to count as “content”
                const minRun = opts.minRun ?? 10;     // consecutive rows/cols required above threshold
                const pad = opts.pad ?? 8;      // pixels of padding around the box

                // Row sums (how many white pixels per row)
                const rowSum = new Uint32Array(height);
                for (let y = 0; y < height; y++) {
                    let s = 0, base = y * width;
                    for (let x = 0; x < width; x++) if (binary[base + x] === 255) s++;
                    rowSum[y] = s;
                }

                // Column sums (how many white pixels per column)
                const colSum = new Uint32Array(width);
                for (let x = 0; x < width; x++) {
                    let s = 0;
                    for (let y = 0; y < height; y++) if (binary[y * width + x] === 255) s++;
                    colSum[x] = s;
                }

                const rowThresh = Math.max(1, Math.floor(width * minFrac));
                const colThresh = Math.max(1, Math.floor(height * minFrac));

                function firstRunAbove(arr, thresh, runReq) {
                    let run = 0;
                    for (let i = 0; i < arr.length; i++) {
                        if (arr[i] > thresh) { if (++run >= runReq) return i - run + 1; }
                        else run = 0;
                    }
                    return 0;
                }
                function lastRunAbove(arr, thresh, runReq) {
                    let run = 0;
                    for (let i = arr.length - 1; i >= 0; i--) {
                        if (arr[i] > thresh) { if (++run >= runReq) return i + run - 1; }
                        else run = 0;
                    }
                    return arr.length - 1;
                }

                let top = firstRunAbove(rowSum, rowThresh, minRun);
                let bottom = lastRunAbove(rowSum, rowThresh, minRun);
                let left = firstRunAbove(colSum, colThresh, minRun);
                let right = lastRunAbove(colSum, colThresh, minRun);

                // Bail if something went sideways
                if (bottom <= top + 2 || right <= left + 2) return null;

                // Add padding, clamp to image
                top = Math.max(0, top - pad);
                bottom = Math.min(height - 1, bottom + pad);
                left = Math.max(0, left - pad);
                right = Math.min(width - 1, right + pad);

                return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
            }

/**
 * Enhanced auto-crop that first tries to detect the card's rectangular border
 * (long, nearly full-width/height black lines) on the binary mask. If found,
 * we crop to the inner rectangle. If not, we fall back to the white-run method.
 */
function computeAutoCropBoxSmart(binary, width, height) {
  // 1) Try to detect top/bottom borders via black pixel runs
  const rowBlack = new Uint32Array(height);
  for (let y = 0; y < height; y++) {
    let s = 0; const base = y * width;
    for (let x = 0; x < width; x++) s += (binary[base + x] === 0) ? 1 : 0;
    rowBlack[y] = s;
  }
  const colBlack = new Uint32Array(width);
  for (let x = 0; x < width; x++) {
    let s = 0;
    for (let y = 0; y < height; y++) s += (binary[y * width + x] === 0) ? 1 : 0;
    colBlack[x] = s;
  }

  const rowEdgeThresh = Math.floor(width * 0.60);   // wide black line covering most of row
  const colEdgeThresh = Math.floor(height * 0.60);  // wide black line covering most of column

  function firstRunAbove(arr, thresh, runReq) {
    let run = 0;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] >= thresh) { if (++run >= runReq) return i - run + 1; } else run = 0;
    }
    return -1;
  }
  function lastRunAbove(arr, thresh, runReq) {
    let run = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] >= thresh) { if (++run >= runReq) return i + run - 1; } else run = 0;
    }
    return -1;
  }

  const topEdge    = firstRunAbove(rowBlack, rowEdgeThresh, 2);
  const bottomEdge = lastRunAbove(rowBlack, rowEdgeThresh, 2);
  const leftEdge   = firstRunAbove(colBlack, colEdgeThresh, 2);
  const rightEdge  = lastRunAbove(colBlack, colEdgeThresh, 2);

  if (topEdge >= 0 && bottomEdge >= 0 && leftEdge >= 0 && rightEdge >= 0 && bottomEdge > topEdge + 4 && rightEdge > leftEdge + 4) {
    // Crop to the interior of the rectangle with a 1px inward offset
    const padIn = 1;
    const x = Math.max(0, leftEdge + padIn);
    const y = Math.max(0, topEdge + padIn);
    const w = Math.min(width  - x, rightEdge - leftEdge - padIn * 2 + 1);
    const h = Math.min(height - y, bottomEdge - topEdge - padIn * 2 + 1);
    if (w > 8 && h > 8) return { x, y, w, h };
  }

  // 2) Fallback to prior white-run (content) based crop
  const fallback = computeAutoCropBox(binary, width, height, { minFrac: 0.35, minRun: 10, pad: 8 });
  return fallback;
}

/**
 * Auto-crop by finding the largest connected WHITE component on a coarse grid.
 * Rationale: the business-card interior is one big white region; bottom speckle
 *            remains fragmented and is ignored.
 * Returns { x, y, w, h } in full-resolution pixels, or null on failure.
 */
function computeAutoCropBoxCC(binary, width, height, opts = {}) {
  const stride = Math.max(2, (opts.stride | 0) || 3);           // sampling stride
  const blockWhite = Math.min(1, Math.max(0.3, opts.blockWhite || 0.6));
  const pad = (opts.pad | 0) || 8;

  // Build integral image of WHITE indicator for O(1) block sums
  const W = width + 1, H = height + 1;
  const integ = new Uint32Array(W * H);
  for (let y = 1; y < H; y++) {
    let rowsum = 0;
    const src = (y - 1) * width;
    for (let x = 1; x < W; x++) {
      rowsum += (binary[src + (x - 1)] === 255) ? 1 : 0;
      integ[y * W + x] = integ[(y - 1) * W + x] + rowsum;
    }
  }
  const w2 = Math.max(1, Math.floor(width / stride));
  const h2 = Math.max(1, Math.floor(height / stride));

  function sumRect(x0, y0, x1, y1) { // inclusive-exclusive
    return integ[y1 * W + x1] - integ[y0 * W + x1] - integ[y1 * W + x0] + integ[y0 * W + x0];
  }

  // Coarse grid labeling: 1 if the block is mostly white, else 0
  const grid = new Uint8Array(w2 * h2);
  for (let gy = 0; gy < h2; gy++) {
    const y0 = gy * stride;
    const y1 = Math.min(height, y0 + stride);
    for (let gx = 0; gx < w2; gx++) {
      const x0 = gx * stride;
      const x1 = Math.min(width, x0 + stride);
      const area = (x1 - x0) * (y1 - y0);
      const whites = sumRect(x0, y0, x1, y1);
      grid[gy * w2 + gx] = (whites / area) >= blockWhite ? 1 : 0;
    }
  }

  // 4-connected component BFS on coarse grid
  const visited = new Uint8Array(w2 * h2);
  const qx = new Int32Array(w2 * h2);
  const qy = new Int32Array(w2 * h2);
  let bestArea = 0; let best = null;
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      const idx = y * w2 + x;
      if (grid[idx] === 0 || visited[idx]) continue;
      let head = 0, tail = 0;
      qx[tail] = x; qy[tail] = y; tail++;
      visited[idx] = 1;
      let minx = x, miny = y, maxx = x, maxy = y, area = 0;
      while (head < tail) {
        const cx = qx[head], cy = qy[head]; head++;
        area++;
        if (cx < minx) minx = cx; if (cx > maxx) maxx = cx;
        if (cy < miny) miny = cy; if (cy > maxy) maxy = cy;
        const nx = [cx - 1, cx + 1, cx, cx];
        const ny = [cy, cy, cy - 1, cy + 1];
        for (let k = 0; k < 4; k++) {
          const xx = nx[k], yy = ny[k];
          if (xx < 0 || yy < 0 || xx >= w2 || yy >= h2) continue;
          const nidx = yy * w2 + xx;
          if (grid[nidx] === 1 && !visited[nidx]) {
            visited[nidx] = 1;
            qx[tail] = xx; qy[tail] = yy; tail++;
          }
        }
      }
      if (area > bestArea) { bestArea = area; best = { minx, miny, maxx, maxy }; }
    }
  }

  if (!best) return null;
  // Map back to full res and pad
  let left   = Math.max(0, best.minx * stride - pad);
  let top    = Math.max(0, best.miny * stride - pad);
  let right  = Math.min(width  - 1, (best.maxx + 1) * stride + pad - 1);
  let bottom = Math.min(height - 1, (best.maxy + 1) * stride + pad - 1);
  if (bottom <= top + 2 || right <= left + 2) return null;
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

        /**
         * Purpose: Normalize Tesseract logger messages to concise strings for UI.
         */
        function formatLog(message) {
            if (!message) return '';
            if (typeof message === 'string') return message;
            if (message.text) return message.text;
            if (message.status) {
                const progress = typeof message.progress === 'number' ? ` ${(message.progress * 100).toFixed(1)}%` : '';
                return `${message.status.replace(/_/g, ' ')}${progress}`;
            }
            if (message.message) return message.message;
            return JSON.stringify(message);
        }

        /**
         * Purpose: Heuristically detect if the text includes characters from an extra language (e.g., Polish) and request that language from Tesseract.
         * Output: IANA tesseract code or null.
         * Edge: Only loads once per session per language.
         */
        function detectExtraLanguage(text) {
            if (!text) return null;
            for (const entry of EXTRA_LANGUAGE_MAP) {
                if (!state.loadedLanguages.includes(entry.lang) && entry.pattern.test(text)) {
                    return entry.lang;
                }
            }
            return null;
        }

        /**
         * Purpose: Average confidence of word array as a 0..100 number proxy.
         * Input: Tesseract word objects (may lack confidence).
         * Output: mean confidence (0..100 scale assumed by caller).
         */
        function meanConfidence(words) {
            if (!words || words.length === 0) return 0;
            const total = words.reduce((acc, word) => acc + (word.confidence || 0), 0);
            return total / words.length;
        }

        /**
         * Purpose: Compute a bounding box that covers all given words.
         * Output: { x0, y0, x1, y1 } or null if words lack bbox.
         */
        function summarizeWords(words) {
            if (!words || words.length === 0) return null;
            let x0 = Infinity;
            let y0 = Infinity;
            let x1 = -Infinity;
            let y1 = -Infinity;
            words.forEach((word) => {
                if (word.bbox) {
                    x0 = Math.min(x0, word.bbox.x0);
                    y0 = Math.min(y0, word.bbox.y0);
                    x1 = Math.max(x1, word.bbox.x1);
                    y1 = Math.max(y1, word.bbox.y1);
                }
            });
            if (!Number.isFinite(x0) || !Number.isFinite(x1)) {
                return null;
            }
            return { x0, y0, x1, y1 };
        }

            /**
             * Purpose: Line‑gated email extraction.
             * Method
             *   1) Find the word on a line that contains '@'.
             *   2) Define a tight y‑band from that word's bbox (±2px tolerance).
             *   3) Concatenate only words whose vertical centers fall inside the band.
             *   4) Normalize and regex‑extract the email substring.
             * Rationale: Prevents accidental concatenation with adjacent phone numbers above/below.
             * Output: { value, confidence, words, bbox } with best match per line.
             */
            function extractEmailFromLines(lines) {
                let best = { value: null, confidence: 0, words: null, bbox: null };
                if (!Array.isArray(lines)) return best;

                for (const line of lines) {
                    if (!line || !Array.isArray(line.words) || line.words.length === 0) continue;

                    // Find the word that actually carries the '@' character
                    const atWordIndex = line.words.findIndex(w => typeof w.text === 'string' && w.text.includes('@'));
                    if (atWordIndex === -1) continue;
                    const atWord = line.words[atWordIndex];
                    if (!atWord || !atWord.bbox) continue;

                    // Define the y-band based on the @-word's bbox, with a small tolerance
                    const tol = 2; // pixels tolerance
                    const yMin = atWord.bbox.y0 - tol;
                    const yMax = atWord.bbox.y1 + tol;

                    // Only keep words whose vertical center lies inside this band
                    const gatedWords = line.words.filter(w => {
                        if (!w || !w.bbox) return false;
                        const cy = (w.bbox.y0 + w.bbox.y1) / 2;
                        return cy >= yMin && cy <= yMax;
                    });
                    if (gatedWords.length === 0) continue;
                    console.log('Gated words for email candidate:', gatedWords);

                    // Join gated words WITHOUT spaces (emails have none); normalize; then extract substring
                    const combined = gatedWords.map(w => (w.text || '').trim()).join('');
                    console.log('Combined email candidate:', combined);
                    const norm = normalizeEmailCandidate(combined);
                    console.log('Normalized email candidate:', norm);
                    const match = norm.match(EMAIL_REGEX);
                    console.log('Email regex match:', match);
                    if (!match) continue;

                    const candidate = match[0];
                    const confidence = meanConfidence(gatedWords);
                    if (confidence > best.confidence) {
                        best = {
                            value: candidate,
                            confidence,
                            words: gatedWords,
                            bbox: summarizeWords(gatedWords)
                        };
                    }
                }
                console.log('Extracted email:', best);

                return best;
            }

        /**
         * Purpose: End‑to‑end pipeline to preprocess, OCR, and extract structured fields.
         * Inputs
         *   - image: HTMLImageElement
         *   - adjustments: crop/rotation from UI
         *   - callbacks: { onAttempt?, onProgress?, onStatus? }
         * Outputs
         *   - structured: { raw_text, fields: { name, phone, email }, debug }
         *   - attemptHistory: preprocessing/PSM retries and warnings
         *   - canvas: final preprocessed canvas
         * Notes
         *   - Uses a general pass (PSM 6/4) then targeted passes (PSM 11) for email/phone.
         *   - Dynamically loads extra languages if detected.
         *   - Falls back to a final run if heuristic retries all warn.
         */
        async function extractCardData(image, adjustments, { onAttempt, onProgress, onStatus } = {}) {
            await ensureWorker();
            const worker = state.worker;
            const attemptHistory = [];
            const warningsSet = new Set();
            const baseTargetWidth = DEFAULT_TARGET_WIDTH;
            const attemptSettings = [
                { targetWidth: baseTargetWidth, psm: 6 },
                { targetWidth: Math.max(2200, baseTargetWidth + 200), psm: 6 },
                { targetWidth: Math.max(2600, baseTargetWidth + 400), psm: 4 }
            ];

            let finalGeneral = null;
            let finalPreprocess = null;
            let generalPSMUsed = 6;
            let extraLanguageApplied = false;

            for (let attemptIndex = 0; attemptIndex < attemptSettings.length; attemptIndex++) {
                const attempt = attemptSettings[attemptIndex];
                if (onStatus) onStatus(`Preprocessing (target width ${attempt.targetWidth}px)…`);
                const preprocessResult = preprocessImage(image, adjustments, { targetWidth: attempt.targetWidth });
                const historyEntry = {
                    attempt: attemptIndex + 1,
                    targetWidth: preprocessResult.canvas.width,
                    psm: attempt.psm,
                    steps: preprocessResult.steps,
                    warnings: []
                };

                let rerun = false;
                do {
                    rerun = false;
                    const logs = [];
                    recognitionContext = {
                        label: 'General pass',
                        logs,
                        progressRange: [attemptIndex === 0 ? 0 : 20, 70]
                    };
                    await worker.setParameters({
                        user_defined_dpi: '300',
                        tessedit_pageseg_mode: String(attempt.psm),
                        preserve_interword_spaces: '1',
                        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+@._-()/&,: '
                    });
                    const generalResult = await worker.recognize(preprocessResult.canvas);
                    recognitionContext = null;

                    const detectedLanguage = detectExtraLanguage(generalResult.data.text);
                    if (detectedLanguage && !state.loadedLanguages.includes(detectedLanguage)) {
                        await worker.loadLanguage(detectedLanguage);
                        await worker.initialize(`eng+${detectedLanguage}`);
                        state.loadedLanguages.push(detectedLanguage);
                        extraLanguageApplied = true;
                        rerun = true;
                        continue;
                    }

                    const warningMessages = logs.filter((log) => REQUIRED_WARNINGS.some((regex) => regex.test(log)));
                    warningMessages.forEach((warning) => warningsSet.add(warning));
                    historyEntry.warnings.push(...warningMessages);

                    const shouldRetry = warningMessages.length > 0 && attemptIndex < attemptSettings.length - 1;
                    if (shouldRetry) {
                        recognitionContext = null;
                        break;
                    }

                    finalGeneral = generalResult;
                    finalPreprocess = preprocessResult;
                    generalPSMUsed = attempt.psm;
                    historyEntry.success = true;
                    const extraLangs = state.loadedLanguages.slice(1);
                    if (extraLangs.length) {
                        historyEntry.extraLanguage = extraLangs.join(', ');
                    }
                    attemptHistory.push({ ...historyEntry });
                    extraLanguageApplied = false;
                    break;
                } while (rerun);

                if (finalGeneral) {
                    break;
                }

                const extraLangs = state.loadedLanguages.slice(1);
                if (extraLangs.length) {
                    historyEntry.extraLanguage = extraLangs.join(', ');
                }
                historyEntry.success = false;
                attemptHistory.push({ ...historyEntry });
            }

            if (!finalGeneral) {
                const lastAttempt = attemptSettings[attemptSettings.length - 1];
                finalPreprocess = preprocessImage(image, adjustments, { targetWidth: lastAttempt.targetWidth });
                recognitionContext = {
                    label: 'General pass',
                    logs: [],
                    progressRange: [20, 70]
                };
                await state.worker.setParameters({
                    user_defined_dpi: '300',
                    tessedit_pageseg_mode: String(lastAttempt.psm),
                    preserve_interword_spaces: '1',
                    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+@._-()/&,: '
                });
                finalGeneral = await state.worker.recognize(finalPreprocess.canvas);
                recognitionContext = null;
                generalPSMUsed = lastAttempt.psm;
            }

            updateProgress(75, 'Running targeted passes…');

            recognitionContext = {
                label: 'Email pass',
                logs: [],
                progressRange: [75, 88]
            };
            await state.worker.setParameters({
                user_defined_dpi: '300',
                tessedit_pageseg_mode: '11',
                preserve_interword_spaces: '1',
                tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+@._-',
                tessedit_char_blacklist: '()[]<>{}'
            });
            const emailResult = await state.worker.recognize(finalPreprocess.canvas);
            recognitionContext = null;

            recognitionContext = {
                label: 'Phone pass',
                logs: [],
                progressRange: [88, 100]
            };
            await state.worker.setParameters({
                user_defined_dpi: '300',
                tessedit_pageseg_mode: '11',
                preserve_interword_spaces: '1',
                tessedit_char_whitelist: '+0123456789()- '
            });
            const phoneResult = await state.worker.recognize(finalPreprocess.canvas);
            recognitionContext = null;

            const rawText = (finalGeneral.data.text || '').trim();

            const nameField = extractName(finalGeneral.data.lines || []);

            let emailField = extractEmailFromLines(finalGeneral.data.lines || []);
            if (!emailField.value) {
              emailField = extractEmail(emailResult.data.words || []); // fallback to sparse words
            }

            const phoneField = extractPhone(phoneResult.data.words || []);

            await maybeRefineLowConfidence(finalPreprocess.canvas, nameField, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÁÀÂÄÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕØÚÙÛÜÝŸąćęłńóśźżĄĆĘŁŃÓŚŹŻ ', 7);
            await maybeRefineLowConfidence(
                finalPreprocess.canvas,
                emailField,
                'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+@._-',
                7,
                (v) => normalizeEmailCandidate(v),          // postProcess: normalize
                (text) => {                                 // postExtract: keep ONLY the email substring
                    const m = normalizeEmailCandidate(text).match(EMAIL_REGEX);
                    return m ? m[0] : '';
                }
            );
            await maybeRefineLowConfidence(finalPreprocess.canvas, phoneField, '+0123456789()- ', 7, normalizePhoneValue);

            const fields = {
                name: {
                    value: nameField.value,
                    confidence: roundConfidence(nameField.confidence)
                },
                phone: {
                    value: phoneField.value,
                    confidence: roundConfidence(phoneField.confidence)
                },
                email: {
                    value: emailField.value,
                    confidence: roundConfidence(emailField.confidence)
                }
            };

            const debug = {
                warnings: Array.from(warningsSet),
                dpi: 300,
                psm_general: generalPSMUsed,
                image_width_px: finalPreprocess.canvas.width,
                preprocess_steps: finalPreprocess.steps
            };

            const structured = {
                raw_text: rawText,
                fields,
                debug
            };

            if (onProgress) onProgress(100);
            if (onStatus) onStatus('Completed');

            return {
                structured,
                attemptHistory,
                canvas: finalPreprocess.canvas,
                nameField,
                phoneField,
                emailField
            };
        }

        /**
         * Purpose: Clamp/round confidence to 0..100 with two decimals.
         */
        function roundConfidence(value) {
            if (value == null) return 0;
            return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
        }

        /**
         * Purpose: Heuristic personal name detector from OCR lines.
         * Heuristics: first two tokens Title‑case without digits/@, allow diacritics.
         * Output: best line with bbox + mean confidence.
         * Caveat: May pick company names if styled similarly.
         */
        function extractName(lines) {
            let best = { value: null, confidence: 0, words: null, bbox: null };
            const uppercaseToken = /^[A-ZÀ-ÝŚŁŹŻĆŃÓ][\p{L}'’.-]*$/u;
            for (const line of lines) {
                if (!line || !line.text) continue;
                const tokens = line.text.trim().split(/\s+/).filter(Boolean);
                if (tokens.length < 2) continue;
                if (/[0-9@()+]/.test(line.text)) continue;
                const firstTwo = tokens.slice(0, 2);
                if (!firstTwo.every((token) => uppercaseToken.test(token))) continue;
                const confidence = meanConfidence(line.words || []);
                if (confidence > best.confidence) {
                    best = {
                        value: tokens.join(' ').trim(),
                        confidence,
                        words: line.words || [],
                        bbox: summarizeWords(line.words || [])
                    };
                }
            }
            return best;
        }

        /**
         * Purpose: Fallback email extraction over sparse word segments.
         * Method: Slide a window of 1..3 words, join tokens, regex the email SUBSTRING only.
         * Output: best match with bbox + confidence; lower priority than line‑gated path.
         */
        function extractEmail(words) {
            // Return the best email found by matching the regex against concatenated word segments,
            // but store ONLY the matched substring (not any leading/trailing tokens like a phone number).
            let best = { value: null, confidence: 0, words: null, bbox: null };

            for (let i = 0; i < words.length; i++) {
                // Try short segments because OCR may split an email into 2–3 tokens
                for (let len = 1; len <= 3 && i + len <= words.length; len++) {
                    const segment = words.slice(i, i + len);
                    const combined = segment.map((w) => (w.text || '').trim()).join('');

                    // Find the email SUBSTRING inside the combined text
                    const match = combined.match(EMAIL_REGEX);
                    if (!match) continue;
                    const emailOnly = match[0];

                    // Confidence is computed on the segment level; that's fine for ranking.
                    const confidence = meanConfidence(segment);
                    if (confidence > best.confidence) {
                        best = {
                            value: emailOnly.toLowerCase(),
                            confidence,
                            words: segment,
                            bbox: summarizeWords(segment)
                        };
                    }
                }
            }

            // Final sanitation: re-validate and trim any stray characters just in case
            if (best.value) {
                const finalMatch = best.value.match(EMAIL_REGEX);
                best.value = finalMatch ? finalMatch[0].toLowerCase() : null;
            }

            return best;
        }

        /**
         * Purpose: Extract a phone number by testing joined 1..6‑word windows.
         * Normalization: digits with optional leading '+'.
         * Output: best formatted number and bbox.
         */
        function extractPhone(words) {
            let best = { value: null, confidence: 0, words: null, bbox: null };
            for (let i = 0; i < words.length; i++) {
                let combined = '';
                for (let len = 1; len <= 6 && i + len <= words.length; len++) {
                    const segment = words.slice(i, i + len);
                    combined = segment.map((w) => w.text.trim()).join(' ');
                    const normalized = combined.replace(/[^0-9+]/g, '');
                    const regex = new RegExp(PHONE_REGEX.source, PHONE_REGEX.flags || 'g');
                    if (!regex.test(combined)) continue;
                    const confidence = meanConfidence(segment);
                    const formatted = normalizePhoneValue(combined.trim());
                    if (!formatted) continue;
                    if (confidence > best.confidence) {
                        best = {
                            value: formatted,
                            confidence,
                            words: segment,
                            bbox: summarizeWords(segment)
                        };
                    }
                }
            }
            return best;
        }

        /**
         * Purpose: Normalize free‑form phone text to a compact numeric string.
         * Output: '+<country><number>' or local digits; returns null if empty.
         */
        function normalizePhoneValue(value) {
            if (!value) return null;
            const digits = value.replace(/[^0-9+]/g, '');
            if (!digits) return null;
            if (digits.startsWith('+')) {
                const parts = ['+'];
                for (let i = 1; i < digits.length; i++) {
                    const ch = digits[i];
                    if (/\d/.test(ch)) parts.push(ch);
                }
                return parts.join('');
            }
            return digits.replace(/\D/g, '');
        }

        /**
         * Purpose: Re‑OCR a small field bbox at a stricter PSM/whitelist when confidence is low.
         * Inputs
         *   - canvas: preprocessed full canvas
         *   - field: { value, confidence, bbox }
         *   - whitelist: allowed characters
         *   - psm: page segmentation mode for Tesseract
         *   - postProcess?: transform after OCR (e.g., normalizeEmailCandidate)
         *   - postExtract?: reduce raw text to canonical value (e.g., regex exact email)
         * Behavior: Updates the field in place if confidence improves.
         */
        async function maybeRefineLowConfidence(canvas, field, whitelist, psm, postProcess, postExtract) {
            if (!field || !field.bbox) return;
            if (field.confidence >= 70 && field.value) return;
            const { x0, y0, x1, y1 } = field.bbox;
            if ([x0, y0, x1, y1].some(v => typeof v !== 'number' || Number.isNaN(v))) return;

            const padding = 6;
            const sx = Math.max(0, Math.round(x0 - padding));
            const sy = Math.max(0, Math.round(y0 - padding));
            const sWidth = Math.max(1, Math.min(canvas.width - sx, Math.round(x1 - x0 + padding * 2)));
            const sHeight = Math.max(1, Math.min(canvas.height - sy, Math.round(y1 - y0 + padding * 2)));

            const region = document.createElement('canvas');
            region.width = sWidth; region.height = sHeight;
            region.getContext('2d').drawImage(canvas, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);

            recognitionContext = { label: 'Refine field', logs: [], progressRange: [65, 75] };
            await state.worker.setParameters({
                user_defined_dpi: '300',
                tessedit_pageseg_mode: String(psm),
                preserve_interword_spaces: '1',
                tessedit_char_whitelist: whitelist
            });
            const refined = await state.worker.recognize(region);
            recognitionContext = null;

            const refinedWords = refined.data.words || [];
            const refinedConfidence = meanConfidence(refinedWords);
            let refinedValue = (refined.data.text || '').trim();

            if (typeof postExtract === 'function') {
                refinedValue = postExtract(refinedValue);
            }
            if (postProcess) {
                refinedValue = postProcess(refinedValue);
            }
            if (!refinedValue) return;
            if (!field.value || refinedConfidence > field.confidence) {
                field.value = refinedValue;
                field.confidence = refinedConfidence;
            }
        }

        if (processBtn) {
        processBtn.addEventListener('click', async () => {
            if (!state.image) return;
            processBtn.disabled = true;
            updateStatus('Initializing worker…');
            updateProgress(5);
            try {
                const result = await extractCardData(state.image, state.adjustments, {
                    onProgress: (value) => updateProgress(value),
                    onStatus: (text) => updateStatus(text)
                });
                drawToPreview(result.canvas);
                rawOutput.value = result.structured.raw_text || '[No text detected]';
                jsonOutput.value = JSON.stringify(result.structured, null, 2);
                renderFieldSummary(result.structured.fields);
                renderRetryLog(result.attemptHistory, result.structured.debug);
            } catch (error) {
                console.error(error);
                updateStatus('An error occurred while processing the image.');
                rawOutput.value = error && error.message ? error.message : String(error);
            } finally {
                processBtn.disabled = false;
            }
        });
        }

        /** UI helper: Render normalized fields and confidences. */
        function renderFieldSummary(fields) {
            if (!fieldSummary) return;
            fieldSummary.innerHTML = '';
            Object.entries(fields).forEach(([key, data]) => {
                const row = document.createElement('div');
                row.className = 'field-row';
                const label = document.createElement('span');
                label.textContent = key.toUpperCase();
                const value = document.createElement('div');
                value.textContent = `${data.value ?? '—'} (conf ${data.confidence.toFixed(2)})`;
                row.appendChild(label);
                row.appendChild(value);
                fieldSummary.appendChild(row);
            });
        }

        /** UI helper: Summarize attempts, warnings, and preprocess steps for debugging. */
        function renderRetryLog(history, debug) {
            if (!retryLog) return;
            retryLog.innerHTML = '';
            const combined = history.length ? history : [{ attempt: 1, targetWidth: debug.image_width_px, psm: debug.psm_general, warnings: debug.warnings || [], success: true }];
            combined.forEach((entry) => {
                const li = document.createElement('li');
                const status = entry.success ? '✅' : '⚠️';
                const warningsText = entry.warnings && entry.warnings.length ? `Warnings: ${entry.warnings.join('; ')}` : 'Warnings: none';
                const extraLang = entry.extraLanguage ? ` | extra language: ${entry.extraLanguage}` : '';
                li.innerHTML = `<strong>${status} Attempt ${entry.attempt}:</strong> scale-${entry.targetWidth}, PSM ${entry.psm}${extraLang}<br>${warningsText}<br>Steps: ${entry.steps.join(', ')}`;
                retryLog.appendChild(li);
            });
            if (debug && debug.preprocess_steps) {
                const li = document.createElement('li');
                li.innerHTML = `<strong>Final preprocess steps:</strong> ${debug.preprocess_steps.join(', ')}`;
                retryLog.appendChild(li);
            }
        }

        window.extractCardData = extractCardData;
})();
