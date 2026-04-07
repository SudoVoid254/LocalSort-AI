/**
 * ui-handler.js - DOM updates and view transitions
 */

export class UIHandler {
    constructor(app) {
        this.app = app;
        this.views = {};
    }

    init() {
        this.cacheElements();
        this.bindEvents();
    }

    cacheElements() {
        this.stepperSteps = document.querySelectorAll('.step');
        this.views = document.querySelectorAll('.view');
        this.btnSelectFolder = document.getElementById('btn-select-folder');
        this.btnApplyChanges = document.getElementById('btn-apply-changes');
    }

    bindEvents() {
        this.btnSelectFolder.addEventListener('click', () => {
            this.app.handleSelectFolder();
        });

        this.btnApplyChanges.addEventListener('click', () => {
            if (confirm('This will move your files. A rollback is possible, but please ensure you have a backup if the files are critical. Proceed?')) {
                this.app.handleApplyChanges();
            }
        });

        document.getElementById('btn-add-rule').addEventListener('click', () => {
            this.app.handleAddRule();
        });

        document.getElementById('btn-to-preview').addEventListener('click', () => {
            this.app.updateState('PREVIEW');
        });

        document.getElementById('btn-back-to-config').addEventListener('click', () => {
            this.app.updateState('CONFIG');
        });

        const btnRollback = document.getElementById('btn-rollback');
        if (btnRollback) {
            btnRollback.addEventListener('click', () => this.app.handleRollback());
        }
    }



    updateStepper(state) {
        this.stepperSteps.forEach(step => {
            step.classList.toggle('active', step.dataset.step === state);
        });
    }

    switchView(state) {
        this.views.forEach(view => {
            view.classList.toggle('active', view.id === `view-${state}`);
        });
    }

    updateStatusBar(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    updateProgress(id, percent) {
        const bar = document.getElementById(id);
        if (bar) bar.style.width = `${percent}%`;
    }

    updateStatus(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    renderRules(rules) {
        const container = document.getElementById('rules-container');
        container.innerHTML = '';

        rules.forEach((rule, index) => {
            const div = document.createElement('div');
            div.className = 'rule-item';
            div.style.marginBottom = '10px';
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.gap = '10px';
            div.style.justifyContent = 'center';

            div.innerHTML = `
                <div class="rule-row">
                    <span>If label matches </span>
                    <input type="text" class="rule-input" value="${rule.pattern}" data-index="${index}" data-field="pattern" style="width: 80px; padding: 2px 5px;">
                    <span> $\to$ move to </span>
                    <input type="text" class="rule-input" value="${rule.target}" data-index="${index}" data-field="target" style="width: 150px; padding: 2px 5px;">
                    <button class="secondary-btn btn-sm" data-index="${index}" style="margin-left: 10px; padding: 5px 10px;">Delete</button>
                </div>
            `;
            container.appendChild(div);
        });

        container.querySelectorAll('.rule-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const index = e.target.dataset.index;
                const field = e.target.dataset.field;
                const value = e.target.value;

                const rules = [...this.app.config.rules];
                rules[index][field] = value;
                this.app.config.saveRules(rules);
            });
        });

        container.querySelectorAll('.btn-sm').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = e.target.dataset.index;
                this.app.config.removeRule(index);
                this.renderRules(this.app.config.rules);
            });
        });
    }
}
