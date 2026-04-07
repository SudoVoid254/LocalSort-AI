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
     * @param {Object} fileData { labels: [], originalPath: "", handle: ... }
     * @returns {string|null} The calculated target path or null if no rules match.
     */
    calculatePath(fileData) {
        for (const rule of this.rules) {
            if (rule.type === 'label') {
                const label = fileData.labels[0];
                if (label && new RegExp(rule.pattern, 'i').test(label)) {
                    return rule.target.replace('{label}', label);
                }
            }
            // Other rule types (date, etc) can be added here
        }
        return null;
    }
}

