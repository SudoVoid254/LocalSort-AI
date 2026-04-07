/**
 * ai-engine.js - Transformers.js integration
 */

export class AIEngine {
    constructor() {
        this.worker = null;
        this.isReady = false;
        this.defaultLabels = ['people', 'landscape', 'indoor', 'outdoor', 'urban', 'rural', 'nature', 'document'];
    }

    async init(onStatus, onReady) {
        try {
            this.worker = new Worker('./js/ai-worker.js', { type: 'module' });
        } catch (err) {
            console.error('Failed to create worker:', err);
            onStatus('Worker Creation Failed');
            return;
        }

        this.worker.onmessage = (e) => {
            const { type, payload } = e.data;
            if (type === 'STATUS') onStatus(payload);
            if (type === 'READY') {
                this.isReady = true;
                onReady();
            }
            if (type === 'ERROR') {
                console.error('AI Worker Error:', payload);
                onStatus(`Error: ${payload}`);
            }
        };

        this.worker.onerror = (err) => {
            console.error('Worker global error:', err);
            onStatus('Worker Crash');
        };

        this.worker.postMessage({ type: 'INIT' });
    }

    async labelImage(fileBlob, customLabels = null) {
        // Use provided custom labels or fall back to defaults
        const labelsToUse = customLabels && customLabels.length > 0
            ? customLabels
            : this.defaultLabels;

        return new Promise((resolve, reject) => {
            if (!this.isReady) {
                reject('AI Engine not ready');
                return;
            }

            const handler = (e) => {
                const { type, payload } = e.data;
                if (type === 'RESULT') {
                    this.worker.removeEventListener('message', handler);
                    resolve(payload);
                } else if (type === 'ERROR') {
                    this.worker.removeEventListener('message', handler);
                    reject(payload);
                }
            };

            this.worker.addEventListener('message', handler);
            this.worker.postMessage({
                type: 'LABEL',
                payload: { imageBlob: fileBlob, labels: labelsToUse }
            });
        });
    }
}

