/**
 * config-store.js - User sorting rules management
 */

export class ConfigStore {
    constructor() {
        this.rules = this.loadRules();
        this.confidenceThreshold = parseFloat(localStorage.getItem('localsort-threshold')) || 0.5;
        this.duplicateStrategy = localStorage.getItem('localsort-duplicate-strategy') || 'rename';
    }

    loadRules() {
        const stored = localStorage.getItem('localsort-rules');
        return stored ? JSON.parse(stored) : [
            { id: 'default-label', type: 'label', field: 'primary', pattern: '.*', target: 'Organized/{label}/{year}-{month}-{day}_{label}.{ext}', mediaType: 'all' }
        ];
    }

    saveRules(rules) {
        this.rules = rules;
        localStorage.setItem('localsort-rules', JSON.stringify(rules));
    }

    saveThreshold(val) {
        this.confidenceThreshold = val;
        localStorage.setItem('localsort-threshold', val.toString());
    }

    saveDuplicateStrategy(strategy) {
        this.duplicateStrategy = strategy;
        localStorage.setItem('localsort-duplicate-strategy', strategy);
    }

    addRule(rule) {
        this.rules.push(rule);
        this.saveRules(this.rules);
    }

    removeRule(index) {
        this.rules.splice(index, 1);
        this.saveRules(this.rules);
    }

    /**
     * Calculates the target path for a file based on the active rules.
     * @param {Object} fileData { labels: [], topLabel: "", confidence: 0, make: "", model: "", isVideo: false, ... }
     * @returns {string|null} The calculated target path or null if no rules match.
     */
    calculatePath(fileData, fileName) {
        // If confidence is too low, send to review folder
        if (fileData.confidence < this.confidenceThreshold && fileData.topLabel !== 'unknown') {
            const label = fileData.topLabel || 'uncertain';
            return `Review_Required/${label}/${fileName}`;
        }

        const date = fileData.date || new Date(fileData.handle?.lastModified || Date.now());
        const extMatch = fileName.match(/\.([^.]+)$/);
        const ext = extMatch ? extMatch[1] : '';

        const dataMap = {
            year: date.getFullYear().toString(),
            month: (date.getMonth() + 1).toString().padStart(2, '0'),
            day: date.getDate().toString().padStart(2, '0'),
            label: fileData.topLabel || 'unknown',
            labels: (fileData.labels || []).join(', '),
            make: fileData.make || 'Unknown',
            model: fileData.model || 'Unknown',
            city: fileData.city || 'Unknown',
            country: fileData.country || 'Unknown',
            confidence: (fileData.confidence * 100).toFixed(0) + '%',
            ext: ext,
            original: fileName.replace(/\.[^.]+$/, '')
        };

        for (const rule of this.rules) {
            // Media Type Filter
            if (rule.mediaType && rule.mediaType !== 'all') {
                if (rule.mediaType === 'video' && !fileData.isVideo) continue;
                if (rule.mediaType === 'photo' && fileData.isVideo) continue;
            }

            if (rule.type === 'label') {
                const label = fileData.topLabel || 'unknown';
                const allLabels = (fileData.labels || []).map(l => l.toLowerCase());

                let shouldApply = false;
                const pattern = rule.pattern.trim();

                if (pattern.includes(',')) {
                    const required = pattern.split(',').map(l => l.trim().toLowerCase());
                    shouldApply = required.every(rl => allLabels.includes(rl));
                } else {
                    const isNegation = pattern.startsWith('!');
                    const actualPattern = isNegation ? pattern.substring(1) : pattern;
                    const regex = new RegExp(actualPattern === '.*' ? '^.*$' : `^${actualPattern}$`, 'i');
                    const matches = regex.test(label);
                    shouldApply = isNegation ? !matches : matches;
                }

                if (shouldApply) {
                    let target = rule.target.replace(/{(\w+)}/g, (match, key) => {
                        return dataMap[key] || match;
                    });
                    
                    // If target doesn't look like a filename (no extension placeholder), append original filename
                    if (!target.includes('.{ext}') && !target.match(/\.[^.]+$/)) {
                        target = target.endsWith('/') ? `${target}${fileName}` : `${target}/${fileName}`;
                    }
                    return target;
                }
            }
        }
        return `Unorganized/${fileName}`;
    }
}

