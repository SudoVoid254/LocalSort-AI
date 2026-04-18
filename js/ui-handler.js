/**
 * ui-handler.js - DOM updates and view transitions
 */

export class UIHandler {
    constructor(app) {
        this.app = app;
        this.views = {};
        this.activeBlobUrls = new Map(); // element -> { fileName, url }
        
        // Initialize IntersectionObserver for lazy loading
        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.loadImage(entry.target);
                } else {
                    this.unloadImage(entry.target);
                }
            });
        }, { 
            root: document.getElementById('preview-gallery'),
            rootMargin: '200px' 
        });
    }

    async loadImage(wrapper) {
        const img = wrapper.querySelector('img');
        const fileName = wrapper.dataset.fileName;
        const data = this.app.appState.processedFiles.get(fileName);
        
        if (!data || img.src.startsWith('blob:')) return;

        try {
            const file = await data.handle.getFile();
            const url = URL.createObjectURL(file);
            img.src = url;
            this.activeBlobUrls.set(wrapper, { fileName, url });
        } catch (e) {
            console.error(`Failed to load image ${fileName}:`, e);
            img.src = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%2318181b'/><text x='50%25' y='50%25' font-family='sans-serif' font-size='12' fill='%23a1a1aa' text-anchor='middle' dy='.3em'>Error</text></svg>`;
        }
    }

    unloadImage(wrapper) {
        const img = wrapper.querySelector('img');
        const active = this.activeBlobUrls.get(wrapper);
        
        if (active) {
            URL.revokeObjectURL(active.url);
            this.activeBlobUrls.delete(wrapper);
            img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; // Transparent pixel
        }
    }

    cleanupGallery() {
        this.observer.disconnect();
        for (const [wrapper, active] of this.activeBlobUrls.entries()) {
            URL.revokeObjectURL(active.url);
        }
        this.activeBlobUrls.clear();
        const container = document.getElementById('preview-gallery');
        if (container) container.innerHTML = '';
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
                const helpEl = document.getElementById('config-help');
                if (helpEl) helpEl.innerHTML = text;
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
            if (this.validateRules()) {
                this.app.generatePreview();
                this.app.updateState('PREVIEW');
            } else {
                alert("Configuration Error: Please specify a 'Move to' path for all rules. Blank paths can cause file loss.");
            }
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

        // Phase 4 events
        const searchInput = document.getElementById('preview-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => this.renderGallery(this.app.appState.processedFiles, this.app.handleLabelChange.bind(this.app)));
        }

        const confidenceFilter = document.getElementById('filter-confidence');
        if (confidenceFilter) {
            confidenceFilter.addEventListener('change', () => this.renderGallery(this.app.appState.processedFiles, this.app.handleLabelChange.bind(this.app)));
        }

        const presetSelect = document.getElementById('preset-select');
        if (presetSelect) {
            presetSelect.addEventListener('change', (e) => this.app.handleLoadPreset(e.target.value));
        }

        const thresholdSlider = document.getElementById('threshold-slider');
        const thresholdValue = document.getElementById('threshold-value');
        if (thresholdSlider) {
            thresholdSlider.value = this.app.config.confidenceThreshold * 100;
            thresholdValue.textContent = `${thresholdSlider.value}%`;
            
            thresholdSlider.addEventListener('input', (e) => {
                const val = e.target.value;
                thresholdValue.textContent = `${val}%`;
                this.app.config.saveThreshold(val / 100);
            });
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
        
        // Cleanup if moving away from preview
        if (state !== 'PREVIEW' && state !== 'EXECUTION') {
            this.cleanupGallery();
        }
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
        if (!container) return;
        container.innerHTML = '';

        // Create or update datalist for suggestions
        let datalist = document.getElementById('label-suggestions');
        if (!datalist) {
            datalist = document.createElement('datalist');
            datalist.id = 'label-suggestions';
            document.body.appendChild(datalist);
        }
        const labels = Array.from(new Set([
            '.*', 'unknown', 
            ...(this.app.customLabels || []), 
            ...this.app.ai.defaultLabels
        ]));
        datalist.innerHTML = labels.map(l => `<option value="${l}">`).join('');

        rules.forEach((rule, index) => {
            const div = document.createElement('div');
            div.className = 'rule-item';
            div.draggable = true;
            div.dataset.index = index;
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.gap = '10px';
            div.style.justifyContent = 'center';

            div.innerHTML = `
                <div class="rule-drag-handle" style="cursor: grab; color: var(--text-muted);">☰</div>
                <div class="rule-row">
                    <span style="font-size: 0.9rem">If labels match </span>
                    <input list="label-suggestions" class="rule-input" data-index="${index}" data-field="pattern" value="${rule.pattern}" style="width: 140px; padding: 4px; background: var(--bg-color); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                    <span style="font-size: 0.9rem"> move to </span>
                    <input type="text" class="rule-input" value="${rule.target}" data-index="${index}" data-field="target" style="width: 180px; padding: 4px; background: var(--bg-color); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                    <button class="secondary-btn btn-sm" data-index="${index}" style="margin-left: 10px; padding: 5px 10px;">Delete</button>
                </div>
            `;
            
            // Drag events
            div.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', index);
                div.style.opacity = '0.5';
            });

            div.addEventListener('dragend', () => {
                div.style.opacity = '1';
                this.renderRules(this.app.config.rules);
            });

            div.addEventListener('dragover', (e) => {
                e.preventDefault();
                div.style.borderTop = '2px solid var(--primary)';
            });

            div.addEventListener('dragleave', () => {
                div.style.borderTop = '1px solid var(--border-color)';
            });

            div.addEventListener('drop', (e) => {
                e.preventDefault();
                const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
                const toIndex = index;
                
                if (fromIndex !== toIndex) {
                    const rules = [...this.app.config.rules];
                    const [movedRule] = rules.splice(fromIndex, 1);
                    rules.splice(toIndex, 0, movedRule);
                    this.app.config.saveRules(rules);
                    this.renderRules(rules);
                }
            });

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
        if (!container) return;
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
        if (!container) return;
        
        // 1. Cancel previous render and cleanup old URLs
        this.currentRenderId = (this.currentRenderId || 0) + 1;
        const myRenderId = this.currentRenderId;
        
        this.cleanupGallery();
        
        const searchTerm = document.getElementById('preview-search')?.value.toLowerCase() || '';
        const confidenceFilter = document.getElementById('filter-confidence')?.value || '0';

        // 2. Fragment for better performance
        const fragment = document.createDocumentFragment();

        for (const [fileName, data] of processedFiles.entries()) {
            if (myRenderId !== this.currentRenderId) return;

            // Apply filtering
            const label = (data.topLabel || '').toLowerCase();
            const name = fileName.toLowerCase();
            
            if (searchTerm && !label.includes(searchTerm) && !name.includes(searchTerm)) continue;

            if (confidenceFilter === 'low') {
                if (data.confidence >= this.app.config.confidenceThreshold) continue;
            } else {
                const minConfidence = parseFloat(confidenceFilter);
                if (data.confidence < minConfidence) continue;
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'gallery-item-wrapper';
            wrapper.dataset.fileName = fileName;
            wrapper.style.position = 'relative';

            const img = document.createElement('img');
            img.className = 'gallery-item';
            img.style.width = '100px';
            img.style.height = '100px';
            img.style.objectFit = 'cover';
            img.style.cursor = 'pointer';
            img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; // Placeholder

            // Add confidence badge
            const badge = document.createElement('div');
            badge.className = 'confidence-badge';
            const confidencePercent = (data.confidence * 100).toFixed(0);
            badge.textContent = `${confidencePercent}%`;
            badge.style.position = 'absolute';
            badge.style.top = '5px';
            badge.style.right = '5px';
            badge.style.fontSize = '0.6rem';
            badge.style.padding = '2px 4px';
            badge.style.borderRadius = '4px';
            badge.style.background = data.confidence > 0.7 ? 'rgba(34, 197, 94, 0.8)' : 'rgba(239, 68, 68, 0.8)';
            badge.style.color = 'white';

            const imgContainer = document.createElement('div');
            imgContainer.style.position = 'relative';
            imgContainer.appendChild(img);
            imgContainer.appendChild(badge);

            const top3 = (data.allResults || []).slice(0, 3).map(r => `${r.label} (${(r.score * 100).toFixed(0)}%)`).join('\n');
            wrapper.title = `Top Matches:\n${top3}`;

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'gallery-input';
            input.value = data.topLabel || data.labels[0] || '';
            input.addEventListener('change', (e) => onLabelChange(fileName, e.target.value));

            wrapper.appendChild(imgContainer);
            wrapper.appendChild(input);
            
            this.observer.observe(wrapper);
            fragment.appendChild(wrapper);
            
            if (fragment.children.length % 50 === 0) {
                container.appendChild(fragment);
                await new Promise(requestAnimationFrame);
            }
        }
        container.appendChild(fragment);
    }


    validateRules() {
        const inputs = document.querySelectorAll('.rule-row input[data-field="target"]');
        let allValid = true;

        inputs.forEach(input => {
            const value = input.value.trim();
            if (!value) {
                input.style.border = "2px solid var(--danger)";
                allValid = false;
            } else {
                input.style.border = "1px solid var(--border-color)";
            }
        });

        return allValid;
    }
}
