/**
 * ui-handler.js - DOM updates and view transitions
 */

export class UIHandler {
    constructor(app) {
        this.app = app;
        this.views = {};
        this.activeBlobUrls = new Map(); // element -> { fileName, url }

        this.selectedFiles = new Set();
        this.lastSelectedIndex = -1;
        this.visibleFiles = []; // To track order for shift-selection
        this.virtualConfig = {
            itemWidth: 120, // 100px + 20px gap/padding roughly
            itemHeight: 140, // img + input + gaps
            container: null,
            renderRange: { start: 0, end: 0 }
        };

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
            rootMargin: '400px'
        });
    }

    async loadImage(wrapper) {
        const img = wrapper.querySelector('img');
        const fileName = wrapper.dataset.fileName;
        const data = this.app.appState.processedFiles.get(fileName);

        if (!data || img.src.startsWith('blob:')) return;

        try {
            let url;
            if (data.thumbnailBlob) {
                // For videos, use the pre-extracted frame
                url = URL.createObjectURL(data.thumbnailBlob);
            } else {
                // For images, use the original file
                const file = await data.handle.getFile();
                url = URL.createObjectURL(file);
            }
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

        // Stepper navigation
        document.querySelectorAll('.step').forEach(stepEl => {
            stepEl.style.cursor = 'pointer';
            stepEl.addEventListener('click', () => {
                const step = stepEl.dataset.step;
                // Simple safety: only allow jumping if we've already started (processedFiles has data)
                // or if we're going back to INPUT or CONFIG.
                if (step === 'INPUT' || this.app.appState.processedFiles.size > 0 || step === 'CONFIG') {
                    this.app.updateState(step);
                }
            });
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

        const duplicateStrategy = document.getElementById('duplicate-strategy');
        if (duplicateStrategy) {
            duplicateStrategy.value = this.app.config.duplicateStrategy;
            duplicateStrategy.addEventListener('change', (e) => {
                this.app.config.saveDuplicateStrategy(e.target.value);
            });
        }

        const btnDownloadZip = document.getElementById('btn-download-zip');
        if (btnDownloadZip) {
            btnDownloadZip.addEventListener('click', () => this.app.handleExportZip());
        }

        const themeSelect = document.getElementById('theme-select');
        if (themeSelect) {
            const savedTheme = localStorage.getItem('localsort-theme') || 'midnight';
            themeSelect.value = savedTheme;
            this.setTheme(savedTheme);
            themeSelect.addEventListener('change', (e) => {
                this.setTheme(e.target.value);
                localStorage.setItem('localsort-theme', e.target.value);
            });
        }
    }

    setTheme(theme) {
        document.body.classList.remove('theme-frost', 'theme-obsidian');
        if (theme !== 'midnight') {
            document.body.classList.add(`theme-${theme}`);
        }
        // Update color-scheme for scrollbars
        document.documentElement.style.colorScheme = theme === 'frost' ? 'light' : 'dark';
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

    showZipButton() {
        const btn = document.getElementById('btn-download-zip');
        if (btn) btn.style.display = 'inline-block';
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
                <div class="rule-drag-handle" style="cursor: grab; color: var(--text-muted); font-size: 1.2rem;">☰</div>
                <div class="rule-row" style="flex: 1; display: flex; flex-direction: column; gap: 10px;">
                    <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <span style="font-size: 0.9rem">If </span>
                        <select class="rule-input" data-index="${index}" data-field="mediaType" style="padding: 4px; background: var(--bg-color); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                            <option value="all" ${rule.mediaType === 'all' ? 'selected' : ''}>All Media</option>
                            <option value="photo" ${rule.mediaType === 'photo' ? 'selected' : ''}>📷 Photos</option>
                            <option value="video" ${rule.mediaType === 'video' ? 'selected' : ''}>🎥 Videos</option>
                        </select>
                        <span style="font-size: 0.9rem"> labels match </span>
                        <input list="label-suggestions" class="rule-input" data-index="${index}" data-field="pattern" value="${rule.pattern}" style="width: 140px; padding: 4px; background: var(--bg-color); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                        <span style="font-size: 0.9rem"> move to </span>
                        <div style="position: relative; flex: 1; min-width: 200px;">
                            <input type="text" class="rule-input path-input" value="${rule.target}" data-index="${index}" data-field="target" style="width: 100%; padding: 4px; background: var(--bg-color); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;" placeholder="e.g. Organized/{label}/{original}.{ext}">
                        </div>
                        <button class="secondary-btn btn-sm" data-index="${index}" style="padding: 5px 10px;">Delete</button>
                    </div>
                    
                    <div class="tag-picker" style="display: flex; gap: 5px; flex-wrap: wrap;">
                        <span style="font-size: 0.7rem; color: var(--text-muted); align-self: center; margin-right: 5px;">Insert Tag:</span>
                        ${['label', 'year', 'month', 'day', 'make', 'model', 'city', 'country', 'original', 'ext'].map(tag => `
                            <button class="tag-chip" data-tag="{${tag}}" data-index="${index}" style="padding: 2px 8px; font-size: 0.7rem; border-radius: 12px; background: rgba(59, 130, 246, 0.1); color: var(--primary); border: 1px solid rgba(59, 130, 246, 0.2); cursor: pointer;">{${tag}}</button>
                        `).join('')}
                    </div>
                    
                    <div class="path-preview" data-index="${index}" style="font-size: 0.75rem; color: var(--text-muted); font-style: italic; border-left: 2px solid var(--border-color); padding-left: 10px;">
                        Example: ${this.generatePathPreview(rule.target)}
                    </div>
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

        // Add Tag Picker Logic
        container.querySelectorAll('.tag-chip').forEach(chip => {
            chip.addEventListener('click', (e) => {
                const index = e.target.dataset.index;
                const tag = e.target.dataset.tag;
                const input = container.querySelector(`.path-input[data-index="${index}"]`);

                const start = input.selectionStart;
                const end = input.selectionEnd;
                const text = input.value;
                const before = text.substring(0, start);
                const after = text.substring(end);

                input.value = before + tag + after;
                input.focus();
                input.setSelectionRange(start + tag.length, start + tag.length);

                // Trigger change to save
                input.dispatchEvent(new Event('change'));
            });
        });

        container.querySelectorAll('.rule-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const index = e.target.dataset.index;
                const field = e.target.dataset.field;
                const value = e.target.value;

                const rules = [...this.app.config.rules];
                rules[index][field] = value;
                this.app.config.saveRules(rules);

                // Update preview if target changed
                if (field === 'target') {
                    const preview = container.querySelector(`.path-preview[data-index="${index}"]`);
                    if (preview) preview.textContent = `Example: ${this.generatePathPreview(value)}`;
                }
            });

            // Real-time preview update
            if (input.dataset.field === 'target') {
                input.addEventListener('input', (e) => {
                    const index = e.target.dataset.index;
                    const preview = container.querySelector(`.path-preview[data-index="${index}"]`);
                    if (preview) preview.textContent = `Example: ${this.generatePathPreview(e.target.value)}`;
                });
            }
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
        this.virtualConfig.container = container;

        this.currentRenderId = (this.currentRenderId || 0) + 1;
        const myRenderId = this.currentRenderId;

        this.cleanupGallery();

        const searchTerm = document.getElementById('preview-search')?.value.toLowerCase() || '';
        const confidenceFilter = document.getElementById('filter-confidence')?.value || '0';

        this.visibleFiles = [];
        this.allProcessedFiles = processedFiles; // Store reference for virtual scroll
        this.onLabelChange = onLabelChange;

        for (const [fileName, data] of processedFiles.entries()) {
            if (myRenderId !== this.currentRenderId) return;

            const label = (data.topLabel || '').toLowerCase();
            const name = fileName.toLowerCase();

            if (searchTerm && !label.includes(searchTerm) && !name.includes(searchTerm)) continue;

            if (confidenceFilter === 'low') {
                if (data.confidence >= this.app.config.confidenceThreshold) continue;
            } else {
                const minConfidence = parseFloat(confidenceFilter);
                if (data.confidence < minConfidence) continue;
            }
            this.visibleFiles.push(fileName);
        }

        this.selectedFiles.clear();
        this.updateBulkActionBar();
        this.setupVirtualScroll();
        this.updateVirtualDisplay();
    }

    setupVirtualScroll() {
        const container = this.virtualConfig.container;
        if (!container.dataset.virtualInit) {
            container.addEventListener('scroll', () => this.updateVirtualDisplay());
            window.addEventListener('resize', () => this.updateVirtualDisplay());
            container.dataset.virtualInit = 'true';
        }
    }

    updateVirtualDisplay() {
        if (!this.virtualConfig.container || this.visibleFiles.length === 0) return;

        const container = this.virtualConfig.container;
        const scrollTop = container.scrollTop;
        const containerHeight = container.clientHeight;
        const containerWidth = container.clientWidth;

        const itemsPerRow = Math.floor(containerWidth / this.virtualConfig.itemWidth) || 1;
        const totalRows = Math.ceil(this.visibleFiles.length / itemsPerRow);
        const totalHeight = totalRows * this.virtualConfig.itemHeight;

        // Ensure container has correct scroll height
        let spacer = container.querySelector('.virtual-spacer');
        if (!spacer) {
            spacer = document.createElement('div');
            spacer.className = 'virtual-spacer';
            container.appendChild(spacer);
        }
        spacer.style.height = `${totalHeight}px`;
        spacer.style.width = '1px';
        spacer.style.position = 'absolute';
        spacer.style.top = '0';
        spacer.style.left = '0';
        spacer.style.zIndex = '-1';

        const startRow = Math.floor(scrollTop / this.virtualConfig.itemHeight);
        const endRow = Math.ceil((scrollTop + containerHeight) / this.virtualConfig.itemHeight);

        const startIndex = startRow * itemsPerRow;
        const endIndex = Math.min(endRow * itemsPerRow + itemsPerRow, this.visibleFiles.length);

        if (this.virtualConfig.renderRange.start === startIndex && this.virtualConfig.renderRange.end === endIndex) return;

        this.virtualConfig.renderRange = { start: startIndex, end: endIndex };

        // Optimized rendering: only update if range changed
        const fragment = document.createDocumentFragment();
        fragment.appendChild(spacer);

        for (let i = startIndex; i < endIndex; i++) {
            const fileName = this.visibleFiles[i];
            const data = this.allProcessedFiles.get(fileName);
            const wrapper = this.createGalleryItem(fileName, data, i);

            const row = Math.floor(i / itemsPerRow);
            const col = i % itemsPerRow;
            wrapper.style.position = 'absolute';
            wrapper.style.top = `${row * this.virtualConfig.itemHeight}px`;
            wrapper.style.left = `${col * this.virtualConfig.itemWidth}px`;
            wrapper.style.width = `${this.virtualConfig.itemWidth}px`;
            wrapper.style.height = `${this.virtualConfig.itemHeight}px`;

            fragment.appendChild(wrapper);
            this.observer.observe(wrapper);
        }

        // We can't use innerHTML = '' because of the spacer, but we can clear everything else
        const children = Array.from(container.children);
        children.forEach(child => {
            if (child !== spacer) container.removeChild(child);
        });
        container.appendChild(fragment);
    }

    createGalleryItem(fileName, data, index) {
        const wrapper = document.createElement('div');
        wrapper.className = 'gallery-item-wrapper';
        if (this.selectedFiles.has(fileName)) wrapper.classList.add('selected');
        wrapper.dataset.fileName = fileName;
        wrapper.dataset.index = index;

        wrapper.addEventListener('click', (e) => {
            if (e.target.tagName === 'INPUT') return;

            // If Ctrl/Shift is held, or we already have a selection, toggle selection
            if (e.ctrlKey || e.metaKey || e.shiftKey || this.selectedFiles.size > 0) {
                if (e.shiftKey && this.lastSelectedIndex !== -1) {
                    this.selectRange(this.lastSelectedIndex, index);
                } else {
                    this.toggleSelection(fileName, true);
                    this.lastSelectedIndex = index;
                }
            } else {
                // Otherwise, open Lightbox
                this.showLightbox(fileName);
            }
        });

        const imgContainer = document.createElement('div');
        imgContainer.style.position = 'relative';
        imgContainer.style.width = '100px';
        imgContainer.style.height = '100px';
        imgContainer.style.margin = '0 auto';

        const img = document.createElement('img');
        img.className = 'gallery-item';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

        const badge = document.createElement('div');
        badge.className = 'confidence-badge';
        badge.textContent = `${(data.confidence * 100).toFixed(0)}%`;
        badge.style.background = data.confidence > 0.7 ? 'rgba(34, 197, 94, 0.8)' : 'rgba(239, 68, 68, 0.8)';

        imgContainer.appendChild(img);
        imgContainer.appendChild(badge);

        if (data.isVideo) {
            const videoBadge = document.createElement('div');
            videoBadge.className = 'video-badge';
            videoBadge.innerHTML = '▶';
            imgContainer.appendChild(videoBadge);
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'gallery-input';
        input.value = data.topLabel || data.labels[0] || '';
        input.addEventListener('change', (e) => this.onLabelChange(fileName, e.target.value));

        wrapper.appendChild(imgContainer);
        wrapper.appendChild(input);

        return wrapper;
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

    toggleSelection(fileName, isMulti) {
        if (!isMulti) {
            this.selectedFiles.clear();
            document.querySelectorAll('.gallery-item-wrapper.selected').forEach(el => el.classList.remove('selected'));
        }

        if (this.selectedFiles.has(fileName)) {
            this.selectedFiles.delete(fileName);
            document.querySelector(`.gallery-item-wrapper[data-file-name="${CSS.escape(fileName)}"]`)?.classList.remove('selected');
        } else {
            this.selectedFiles.add(fileName);
            document.querySelector(`.gallery-item-wrapper[data-file-name="${CSS.escape(fileName)}"]`)?.classList.add('selected');
        }
        this.updateBulkActionBar();
    }

    selectRange(start, end) {
        const [low, high] = start < end ? [start, end] : [end, start];
        for (let i = low; i <= high; i++) {
            const fileName = this.visibleFiles[i];
            this.selectedFiles.add(fileName);
            document.querySelector(`.gallery-item-wrapper[data-index="${i}"]`)?.classList.add('selected');
        }
        this.updateBulkActionBar();
    }

    updateBulkActionBar() {
        let bar = document.getElementById('bulk-action-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'bulk-action-bar';
            bar.className = 'bulk-bar';
            document.getElementById('view-PREVIEW').appendChild(bar);
        }

        if (this.selectedFiles.size > 0) {
            bar.classList.add('active');
            bar.innerHTML = `
                <div class="bulk-content">
                    <span>${this.selectedFiles.size} files selected</span>
                    <div class="bulk-actions-group">
                        <input type="text" id="bulk-label-input" placeholder="Set label for all..." style="padding: 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-color); color: var(--text-main);">
                        <button id="btn-bulk-apply" class="primary-btn btn-sm">Apply</button>
                        <button id="btn-bulk-clear" class="secondary-btn btn-sm">Clear</button>
                    </div>
                </div>
            `;

            document.getElementById('btn-bulk-apply').addEventListener('click', () => {
                const label = document.getElementById('bulk-label-input').value;
                if (label) {
                    this.selectedFiles.forEach(fileName => {
                        this.app.handleLabelChange(fileName, label);
                        // Update UI immediately
                        const input = document.querySelector(`.gallery-item-wrapper[data-file-name="${CSS.escape(fileName)}"] .gallery-input`);
                        if (input) input.value = label;
                    });
                    this.addLogEntry(`Bulk updated ${this.selectedFiles.size} files to "${label}"`);
                    this.selectedFiles.clear();
                    document.querySelectorAll('.gallery-item-wrapper.selected').forEach(el => el.classList.remove('selected'));
                    this.updateBulkActionBar();
                }
            });

            document.getElementById('btn-bulk-clear').addEventListener('click', () => {
                this.selectedFiles.clear();
                document.querySelectorAll('.gallery-item-wrapper.selected').forEach(el => el.classList.remove('selected'));
                this.updateBulkActionBar();
            });
        } else {
            bar.classList.remove('active');
        }
    }

    async showLightbox(fileName) {
        const data = this.app.appState.processedFiles.get(fileName);
        if (!data) return;

        const file = data.handle.getFile ? await data.handle.getFile() : data.file;
        const blobUrl = URL.createObjectURL(file);

        let modal = document.getElementById('lightbox-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'lightbox-modal';
            modal.className = 'modal';
            modal.innerHTML = '<div class="modal-content"><span class="close-modal">&times;</span><div id="lightbox-content"></div></div>';
            document.body.appendChild(modal);
        }

        modal.classList.add('active');
        const contentArea = modal.querySelector('.modal-content');

        const confidenceList = (data.allResults || [])
            .map(r => `
                <div class="confidence-row">
                    <span class="label">${r.label}</span>
                    <div class="score-bar-bg"><div class="score-bar" style="width: ${r.score * 100}%"></div></div>
                    <span class="percent">${(r.score * 100).toFixed(1)}%</span>
                </div>
            `).join('');

        contentArea.innerHTML = `
            <span class="close-modal">&times;</span>
            <div class="lightbox-layout">
                <div class="lightbox-main">
                    ${data.isVideo ? `
                        <video controls autoplay loop style="max-width: 100%; max-height: 80vh; border-radius: 8px;">
                            <source src="${blobUrl}" type="video/mp4">
                        </video>
                    ` : `
                        <img src="${blobUrl}" style="max-width: 100%; max-height: 80vh; border-radius: 8px; object-fit: contain;">
                    `}
                </div>
                <div class="lightbox-sidebar">
                    <h3>File Details</h3>
                    <p class="file-name">${fileName}</p>
                    <div class="metadata-grid">
                        <div class="meta-item"><span>Type</span><strong>${data.isVideo ? 'Video' : 'Photo'}</strong></div>
                        <div class="meta-item"><span>Date</span><strong>${data.date ? data.date.toLocaleDateString() : 'Unknown'}</strong></div>
                        <div class="meta-item"><span>Camera</span><strong>${data.make} ${data.model}</strong></div>
                        <div class="meta-item"><span>Location</span><strong>${data.city}, ${data.country}</strong></div>
                    </div>
                    
                    <h3 style="margin-top: 20px;">AI Analysis</h3>
                    <div class="confidence-list">
                        ${confidenceList}
                    </div>

                    <div class="lightbox-actions" style="margin-top: 20px;">
                        <label>Override Label:</label>
                        <input type="text" id="lightbox-label-input" value="${data.topLabel}" style="width: 100%; padding: 8px; margin-top: 5px; border-radius: 4px; background: var(--bg-color); color: var(--text-main); border: 1px solid var(--border-color);">
                        <button id="btn-save-lightbox" class="primary-btn" style="width: 100%; margin-top: 10px;">Save & Close</button>
                    </div>
                </div>
            </div>
        `;

        contentArea.querySelector('.close-modal').onclick = () => modal.classList.remove('active');
        modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('active'); };

        document.getElementById('btn-save-lightbox').onclick = () => {
            const newLabel = document.getElementById('lightbox-label-input').value;
            this.app.handleLabelChange(fileName, newLabel);
            modal.classList.remove('active');
            this.updateVirtualDisplay(); // Refresh gallery
        };
    }

    generatePathPreview(template) {
        const date = new Date();
        const dataMap = {
            year: date.getFullYear().toString(),
            month: (date.getMonth() + 1).toString().padStart(2, '0'),
            day: date.getDate().toString().padStart(2, '0'),
            label: 'Nature',
            labels: 'Nature, Landscape',
            make: 'Apple',
            model: 'iPhone 15',
            city: 'Athens',
            country: 'Greece',
            ext: 'jpg',
            original: 'IMG_4821',
            confidence: '98%'
        };

        let path = template.replace(/{(\w+)}/g, (match, key) => {
            return dataMap[key] || match;
        });

        if (!path.includes('.jpg') && !path.match(/\.[^.]+$/)) {
            path = path.endsWith('/') ? `${path}IMG_4821.jpg` : `${path}/IMG_4821.jpg`;
        }
        return path;
    }
}
