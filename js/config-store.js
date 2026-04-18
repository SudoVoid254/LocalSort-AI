/**
 * config-store.js - User sorting rules management
 */

export class ConfigStore {
    constructor() {
        this.rules = this.loadRules();
        this.confidenceThreshold = parseFloat(localStorage.getItem('localsort-threshold')) || 0.5;
    }

    loadRules() {
        const stored = localStorage.getItem('localsort-rules');
        return stored ? JSON.parse(stored) : [
            { id: 'default-label', type: 'label', field: 'primary', pattern: '.*', target: 'Organized/{label}' }
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
     * @param {Object} fileData { labels: [], topLabel: "", confidence: 0, make: "", model: "", ... }
     * @returns {string|null} The calculated target path or null if no rules match.
     */
    calculatePath(fileData) {
        // If confidence is too low, send to review folder
        if (fileData.confidence < this.confidenceThreshold && fileData.topLabel !== 'unknown') {
            const label = fileData.topLabel || 'uncertain';
            return `Review_Required/${label}`;
        }

        const date = fileData.date || new Date(fileData.handle?.lastModified || Date.now());
        const dataMap = {
            year: date.getFullYear().toString(),
            month: (date.getMonth() + 1).toString().padStart(2, '0'),
            day: date.getDate().toString().padStart(2, '0'),
            label: fileData.topLabel || 'unknown',
            make: fileData.make || 'Unknown',
            model: fileData.model || 'Unknown',
            confidence: (fileData.confidence * 100).toFixed(0) + '%'
        };

        for (const rule of this.rules) {
            if (rule.type === 'label') {
                const label = fileData.topLabel || 'unknown';

                const isNegation = rule.pattern.startsWith('!');
                const actualPattern = isNegation ? rule.pattern.substring(1) : rule.pattern;

                const matches = new RegExp(actualPattern, 'i').test(label);
                const shouldApply = isNegation ? !matches : matches;

                if (shouldApply) {
                    // Expand placeholders: {year}, {month}, {day}, {label}, {make}, {model}, {confidence}
                    return rule.target.replace(/{(\w+)}/g, (match, key) => {
                        return dataMap[key] || match;
                    });
                }
            }
        }
        return null;
    }
}

