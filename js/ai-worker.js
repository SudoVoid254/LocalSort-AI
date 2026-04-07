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

            const result = await classifier(imageUrl, labels);
            const top = result[0];

            self.postMessage({
                type: 'RESULT',
                payload: {
                    label: top.score > 0.3 ? top.label : 'unknown',
                    confidence: top.score
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
