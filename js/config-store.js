/**
 * config-store.js - User sorting rules management
 */

export class ConfigStore {
    constructor() {
        this.rules = this.loadRules();
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
     * @param {Object} fileData { labels: [], originalPath: "", handle: ..., date: Date|null }
     * @returns {string|null} The calculated target path or null if no rules match.
     */
    calculatePath(fileData) {
        const date = fileData.date || new Date(fileData.handle?.lastModified || Date.now());
        const dateMap = {
            year: date.getFullYear().toString(),
            month: (date.getMonth() + 1).toString().padStart(2, '0'),
            day: date.getDate().toString().padStart(2, '0'),
            label: fileData.labels[0] || 'unknown'
        };

        for (const rule of this.rules) {
            if (rule.type === 'label') {
                const label = fileData.labels[0];

                if (!label || label === 'unknown') continue;

                const isNegation = rule.pattern.startsWith('!');
                const actualPattern = isNegation ? rule.pattern.substring(1) : rule.pattern;

                const matches = new RegExp(actualPattern, 'i').test(label);
                const shouldApply = isNegation ? !matches : matches;

                if (shouldApply) {
                    // Expand placeholders: {year}, {month}, {day}, {label}
                    return rule.target.replace(/{(\w+)}/g, (match, key) => {
                        return dateMap[key] || match;
                    });
                }
            }
        }
        return null;
    }
}

