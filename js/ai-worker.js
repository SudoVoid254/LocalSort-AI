/**
 * ai-worker.js - The background thread for AI inference
 * Uses Transformers.js for local image labeling
 */

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers';

// Disable local model check to force CDN fetch if not cached
env.allowLocalModels = false;

let classifier = null;

self.onmessage = async (e) => {
    const { type, payload } = e.data;

    if (type === 'INIT') {
        try {
            self.postMessage({ type: 'STATUS', payload: 'Loading CLIP model...' });
            classifier = await pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32', {
                device: 'webgpu'
            });
            self.postMessage({ type: 'READY' });
        } catch (err) {
            self.postMessage({ type: 'ERROR', payload: err.message });
        }
    }

    if (type === 'LABEL') {
        if (!classifier) {
            self.postMessage({ type: 'ERROR', payload: 'Model not initialized' });
            return;
        }

        let imageUrl = null;

        try {
            const { imageBlob, labels } = payload;
            imageUrl = URL.createObjectURL(imageBlob);

            // Improve zero-shot performance with prompts
            const promptedLabels = labels.map(l => `a photo of ${l}`);
            const result = await classifier(imageUrl, promptedLabels);
            
            // Map back to original labels
            const mappedResults = result.map(r => ({
                label: r.label.replace('a photo of ', ''),
                score: r.score
            }));

            self.postMessage({
                type: 'RESULT',
                payload: {
                    results: mappedResults,
                    top: mappedResults[0]
                }
            });
        } catch (err) {
            self.postMessage({ type: 'ERROR', payload: err.message });
        } finally {
            if (imageUrl) {
                URL.revokeObjectURL(imageUrl);
            }
        }
    }
};
