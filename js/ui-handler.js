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
        this.loadHelp();
    }

    loadHelp() {
        fetch('js/config-help.html')
            .then(r => r.text())
            .then(text => {
                document.getElementById('config-help').innerHTML = text;
            })
            .catch(e => console.error('Help failed to load', e));
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

        document.getElementById('btn-update-labels').addEventListener('click', () => {
            const input = document.getElementById('custom-labels-input');
            this.app.handleUpdateLabels(input.value);
        });

        const btnRollback = document.getElementById('btn-rollback');
        if (btnRollback) {
            btnRollback.addEventListener('click', () => this.app.handleRollback());
        }

        const btnFinish = document.getElementById('btn-finish-execution');
        if (btnFinish) {
            btnFinish.addEventListener('click', () => this.app.handleFinishExecution());
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

    addLogEntry(text) {
        const log = document.getElementById('label-log');
        if (!log) return;
        const entry = document.createElement('div');
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
    }

    clearLog() {
        const log = document.getElementById('label-log');
        if (log) log.innerHTML = '';
    }

    renderRules(rules) {
        const container = document.getElementById('rules-container');
        container.innerHTML = '';

        rules.forEach((rule, index) => {
            const div = document.createElement('div');
            div.className = 'rule-item';
            div.style.marginBottom = '15px';
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.gap = '10px';
            div.style.justifyContent = 'center';
            div.style.background = '#fcfcfc';
            div.style.padding = '10px';
            div.style.border = '1px solid #eee';
            div.style.borderRadius = '4px';

            div.innerHTML = `
                <div class="rule-row">
                    <span style="font-size: 0.9rem">If label is </span>
                    <select class="rule-input" data-index="${index}" data-field="pattern" style="padding: 4px;">
                        <option value=".*" ${rule.pattern === '.*' ? 'selected' : ''}>Any Label</option>
                        ${(this.app.customLabels || this.app.ai.defaultLabels).map(label =>
                            `<option value="${label}" ${rule.pattern === label ? 'selected' : ''}>${label.charAt(0).toUpperCase() + label.slice(1)}</option>`
                        ).join('')}
                        <option value="unknown" ${rule.pattern === 'unknown' ? 'selected' : ''}>Unknown</option>
                    </select>
                    <span style="font-size: 0.9rem"> move to </span>
                    <input type="text" class="rule-input" value="${rule.target}" data-index="${index}" data-field="target" style="width: 150px; padding: 4px;">
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

    renderTree(containerId, tree) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';

        if (Object.keys(tree).length === 0) {
            container.innerHTML = 'No files to display';
            return;
        }

        const renderNode = (name, node, depth = 0) => {
            const indent = '  '.repeat(depth);
            if (node.type === 'directory') {
                let html = `${indent}📁 ${name}/\n`;
                for (const childName in node.children) {
                    html += renderNode(childName, node.children[childName], depth + 1);
                }
                return html;
            } else {
                return `${indent}📄 ${name}\n`;
            }
        };

        let fullTree = '';
        for (const name in tree) {
            fullTree += renderNode(name, tree[name]);
        }
        container.textContent = fullTree;
    }

    async renderGallery(processedFiles, onLabelChange) {
        const container = document.getElementById('preview-gallery');
        container.innerHTML = '';

        for (const [fileName, data] of processedFiles.entries()) {
            const wrapper = document.createElement('div');
            wrapper.style.textAlign = 'center';
            wrapper.style.fontSize = '0.8rem';

            const img = document.createElement('img');
            img.style.width = '100px';
            img.style.height = '100px';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '4px';
            img.style.border = '1px solid #ddd';
            img.style.cursor = 'pointer';

            // In a real FS Access API app, we'd create a URL from the handle
            // For this demo, we'll try to get the file and create a blob URL
            try {
                const file = await data.handle.getFile();
                img.src = URL.createObjectURL(file);
            } catch (e) {
                img.src = 'https://via.placeholder.com/100?text=No+Preview';
            }

            const input = document.createElement('input');
            input.type = 'text';
            input.value = data.labels[0] || '';
            input.style.width = '90px';
            input.style.fontSize = '0.7rem';
            input.style.marginTop = '5px';
            input.style.textAlign = 'center';

            input.addEventListener('change', (e) => {
                onLabelChange(fileName, e.target.value);
            });

            wrapper.appendChild(img);
            wrapper.appendChild(document.createElement('br'));
            wrapper.appendChild(input);
            container.appendChild(wrapper);
        }
    }
}
