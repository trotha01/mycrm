import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { runOCREngine, ocrConfig } from '../scripts/ocrEngine.js';

const DATA_URL = 'data:image/png;base64,stubbed-image-data';

describe('runOCREngine', () => {
  let appendSpy;

  beforeEach(() => {
    ocrConfig.engine = 'tesseract';
    ocrConfig.currentEngine = 'tesseract';
    ocrConfig.fallbackEngine = 'tesseract';

    window.Tesseract = {
      recognize: vi.fn().mockResolvedValue({
        data: {
          text: 'Jane Doe\nAcme Corp\n(555) 123-4567',
          confidence: 86.5
        }
      })
    };

    appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation(node => {
      if (typeof node.onload === 'function') {
        setTimeout(() => node.onload(), 0);
      }
      return node;
    });
  });

  afterEach(() => {
    delete window.Tesseract;
    appendSpy.mockRestore();
  });

  it('invokes Tesseract to recognize text from the provided image data', async () => {
    const progressSpy = vi.fn();

    const result = await runOCREngine(DATA_URL, 'front', progressSpy);

    expect(window.Tesseract.recognize).toHaveBeenCalledTimes(1);
    expect(window.Tesseract.recognize).toHaveBeenCalledWith(
      DATA_URL,
      'eng',
      expect.objectContaining({ logger: expect.any(Function) })
    );
    expect(result).toMatchObject({
      text: 'Jane Doe\nAcme Corp\n(555) 123-4567',
      engineUsed: 'tesseract',
      confidence: 86.5,
      variantType: 'original'
    });
    expect(progressSpy).toHaveBeenCalled();
    const lastProgress = progressSpy.mock.calls[progressSpy.mock.calls.length - 1][0];
    expect(lastProgress).toBe(100);
    expect(appendSpy).toHaveBeenCalled();
  });
});

describe('TensorFlow backend recovery', () => {
  let appendSpy;

  beforeEach(() => {
    appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation(node => {
      if (node.tagName === 'SCRIPT' && typeof node.onload === 'function') {
        setTimeout(() => node.onload(), 0);
      }
      return node;
    });
  });

  afterEach(() => {
    appendSpy.mockRestore();
  });

  it('retries tfjs backend from wasm-out when dist path 404s', async () => {
    const failingScript = document.createElement('script');
    failingScript.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.16.0/dist/tfjs-backend-wasm.js';

    const event = new Event('error', { cancelable: true });
    Object.defineProperty(event, 'target', { value: failingScript });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    window.dispatchEvent(event);

    await Promise.resolve();
    await Promise.resolve();

    const fallbackCall = appendSpy.mock.calls.find(([node]) =>
      node.tagName === 'SCRIPT' && node.src.includes('/wasm-out/tfjs-backend-wasm.js')
    );

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(fallbackCall).toBeTruthy();
  });
});
