# OCR Pipeline Overview

This demo adds a client-side business-card OCR workflow that focuses on accuracy, speed, and deterministic output. The page lives at `ocr.html` and exposes the main `extractCardData` function that accepts an `<img>` or `<canvas>` element and returns a normalized JSON payload.

## Preprocessing sequence

The uploaded image is prepared entirely in the browser using Canvas APIs with the following ordered steps:

1. **Manual crop** – slider-controlled trim on each edge to isolate the business card.
2. **Deskew** – rotation slider (±15°) to keep text horizontal.
3. **Scale** – upscale to a 2000 px baseline (with retry bumps to 2200 px and 2600 px if needed).
4. **Grayscale** – convert to luminance values.
5. **Denoise** – 3×3 Gaussian blur (kernel `[1,2,1;2,4,2;1,2,1]`).
6. **Binarize** – global Otsu thresholding.
7. **Morphological open** – 3×3 erosion followed by dilation to remove specks.
8. **Sharpen** – mild unsharp mask on the binary bitmap to keep edges crisp.

The processed bitmap is previewed beside the original so users can visually confirm a clean black-on-white result.

## Tesseract configuration

* A **single persistent worker** is created on first use and reused for all recognitions.
* Only the English language pack is loaded by default. Additional languages (e.g. `pol`, `deu`, `fra`, `spa`) are loaded dynamically if diacritics are detected in the general pass output.
* Global parameters for the general pass:
  * `user_defined_dpi = 300`
  * `tessedit_pageseg_mode = 6` (fallback to 4 on the final retry)
  * `preserve_interword_spaces = 1`
  * `tessedit_char_whitelist = "A–Z a–z 0–9 + @ . _ - ( ) / & , : space"`

## Recognition strategy

1. **General pass** – runs with the parameters above, capturing the full text, line boxes, and word confidences. If the logs report “Image too small to scale!!” or “Line cannot be recognized!!” the pipeline retries with wider scaling (2200 px then 2600 px) and eventually PSM 4. All retries reuse the same worker.
2. **Email pass** – sparse-text mode (PSM 11) with an email-specific whitelist to isolate the first high-confidence email using regex.
3. **Phone pass** – sparse-text mode (PSM 11) constrained to phone characters, extracting and normalizing to an E.164-style value when a country code is present.
4. **Name detection** – scans general-pass lines, picking the highest-confidence line with two leading capitalized tokens and no punctuation noise.

If any field confidence drops below 70, the page re-recognizes just that region with PSM 7 and a tighter whitelist to boost accuracy.

The final JSON response has deterministic structure:

```json
{
  "raw_text": "<full text>",
  "fields": {
    "name": { "value": "<string|null>", "confidence": <0-100> },
    "phone": { "value": "<normalized>", "confidence": <0-100> },
    "email": { "value": "<string|null>", "confidence": <0-100> }
  },
  "debug": {
    "warnings": ["<tesseract warnings>"] ,
    "dpi": 300,
    "psm_general": 6,
    "image_width_px": <int>,
    "preprocess_steps": ["crop", "deskew", "scale-####", "grayscale", "gaussian-blur-3x3", "otsu", "morph-open", "sharpen"]
  }
}
```

## Known failure modes & mitigation

* **Low-resolution uploads** – trigger the automatic retry path (larger scaling and PSM 4). Manual upscaling before upload helps.
* **Uneven lighting or glare** – adjust the crop to remove bright borders; the Otsu threshold can struggle with heavy gradients.
* **Exotic glyphs** – when diacritics appear that aren’t covered by the current language list, load the closest Tesseract pack and rerun.
* **Field ambiguity** – if confidences stay below 70 even after refinement, double-check the crop/deskew and rerun; severe blur or compression artifacts might require a better photo.

Run the demo by opening `ocr.html` in a modern browser and follow the on-page instructions.
