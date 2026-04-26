/**
 * app.js - Main orchestrator and Finite State Machine
 */

import { FSManager } from './fs-manager.js';
import { UIHandler } from './ui-handler.js';
import { AIEngine } from './ai-engine.js';
import { ConfigStore } from './config-store.js';

class LocalSortApp {
    constructor() {
        this.state = 'INPUT';
        this.fs = new FSManager();
        this.ui = new UIHandler(this);
        this.ai = new AIEngine();
        this.config = new ConfigStore();

        this.appState = {
            directoryHandle: null,
            files: [], // List of all files found during scan
            processedFiles: new Map(), // fileName -> { labels: [], originalPath: "", handle: FileSystemHandle }
            activeRules: [],
            transactionLog: []
        };

        this.init();
    }

    async init() {

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js')
                .then(() => console.log('PWA Service Worker Registered'))
                .catch(err => console.error('PWA Setup Failed', err));
        }

        this.ui.init();

        // Check for File System Access API support
        if (!('showDirectoryPicker' in window)) {
            this.ui.updateStatusBar('fs-status', '❌ Browser not supported');

            const isBrave = navigator.brave && typeof navigator.brave.isBrave === 'function';
            let msg = 'Your browser does not support the File System Access API. Please use a Chromium-based browser (Chrome, Edge, Brave).';

            if (isBrave || navigator.userAgent.includes('Brave')) {
                msg += '\n\nBRAVE USERS: Brave disables this API by default. To enable it:\n1. Go to brave://flags/#file-system-access-api\n2. Set to "Enabled"\n3. Relaunch Brave.';
            } else {
                msg += '\n\nEnsure you are in a secure context (HTTPS or localhost).';
            }
            alert(msg);
        }

        // Initialize AI in background
        this.ai.init(
            (status) => this.ui.updateStatusBar('ai-status', `🧠 AI: ${status}`),
            () => {
                this.ui.updateStatusBar('ai-status', '🧠 AI: Ready');
                // Now that AI is ready, we can also render any rules if we're in CONFIG
                if (this.state === 'CONFIG') {
                    this.ui.renderRules(this.config.rules);
                }
            }
        );

        this.updateState('INPUT');
    }

    async updateState(newState) {
        this.state = newState;
        this.ui.updateStepper(newState);
        this.ui.switchView(newState);

        if (newState === 'CONFIG') {
            this.ui.renderRules(this.config.rules);
        } else if (newState === 'PREVIEW') {
            await this.generatePreview();
        }
    }

    async generatePreview() {
        if (this.previewTimeout) clearTimeout(this.previewTimeout);

        return new Promise((resolve) => {
            this.previewTimeout = setTimeout(async () => {
                // 1. Render the Thumbnail Gallery
                await this.ui.renderGallery(this.appState.processedFiles, this.handleLabelChange.bind(this));

                this.renderTrees();
                resolve();
            }, 100);
        });
    }

    renderTrees() {
        // 2. Current Structure
        const currentTree = {};
        for (const [name, data] of this.appState.processedFiles.entries()) {
            const lastSlash = data.originalPath.lastIndexOf('/');
            const folderPath = lastSlash === -1 ? '' : data.originalPath.substring(0, lastSlash);
            this.addToTree(currentTree, folderPath, name);
        }
        this.ui.renderTree('current-tree', currentTree);

        // 3. Proposed Structure
        const proposedTree = {};
        for (const [name, data] of this.appState.processedFiles.entries()) {
            const targetPath = this.config.calculatePath(data) || 'Unorganized';
            this.addToTree(proposedTree, targetPath, name);
        }
        this.ui.renderTree('proposed-tree', proposedTree);
    }

    addToTree(tree, path, fileName) {
        const parts = path.split('/').filter(p => p);
        let current = tree;

        // 1. Traverse/Create all directory parts
        for (const part of parts) {
            if (!current[part]) {
                current[part] = { type: 'directory', children: {} };
            }
            current = current[part].children;
        }

        // 2. Add the file directly to the last folder reached
        current[fileName] = { type: 'file' };
    }

    async handleUpdateLabels(labelsString) {
        this.customLabels = labelsString.split(',').map(l => l.trim()).filter(l => l);
        this.ui.updateStatusBar('ai-status', `🧠 AI: Labels Updated`);
    }

    async handleSelectFolder() {
        try {
            const handle = await this.fs.selectDirectory();
            this.appState.directoryHandle = handle;
            this.ui.updateStatusBar('fs-status', `📁 ${handle.name}`);

            // Scan for files
            this.ui.updateStatus('label-status', 'Scanning directory...');
            const files = await this.fs.scanDirectory(handle);
            this.appState.files = files;

            // Transition to Labeling
            this.updateState('LABELING');
            await this.startLabeling();
        } catch (err) {
            console.error('Folder selection failed:', err);
        }
    }

    handleLabelChange(fileName, newLabel) {
        const data = this.appState.processedFiles.get(fileName);
        if (data) {
            data.topLabel = newLabel;
            data.labels = [newLabel];
            // Update trees without re-rendering the whole gallery
            this.renderTrees();
        }
    }

    async startLabeling() {
        const supportedExtensions = /\.(jpg|jpeg|png|webp|mp4|mov)$/i;
        const filesToProcess = this.appState.files.filter(f => f.name.match(supportedExtensions));

        if (filesToProcess.length === 0) {
            this.ui.updateStatus('label-status', 'No supported media files found.');
            setTimeout(() => this.updateState('CONFIG'), 2000);
            return;
        }

        await this.ensureAIReady();

        this.ui.updateStatusBar('ai-status', '🧠 AI: Analyzing...');
        this.ui.clearLog();

        for (let i = 0; i < filesToProcess.length; i++) {
            const fileInfo = filesToProcess[i];
            const progress = ((i + 1) / filesToProcess.length) * 100;
            
            this.ui.updateProgress('label-progress-bar', progress);
            this.ui.updateStatus('label-status', `Analyzing ${fileInfo.name} (${i + 1}/${filesToProcess.length})...`);

            try {
                await this.processSingleFile(fileInfo);
            } catch (err) {
                console.error(`Failed to process ${fileInfo.name}:`, err);
                this.handleProcessError(fileInfo, err);
            }
            // Yield to UI thread
            await new Promise(requestAnimationFrame);
        }

        this.ui.updateStatusBar('ai-status', '🧠 AI: Ready');
        this.updateState('CONFIG');
    }

    async ensureAIReady() {
        if (!this.ai.isReady) {
            this.ui.updateStatus('label-status', 'Waiting for AI model to load...');
            while (!this.ai.isReady) {
                await new Promise(res => setTimeout(res, 500));
            }
        }
    }

    async processSingleFile(fileInfo) {
        const isVideo = fileInfo.name.match(/\.(mp4|mov)$/i);
        let result, metadata, frameBlob;
        const file = await fileInfo.handle.getFile();

        if (isVideo) {
            frameBlob = await this.ai.extractVideoFrame(file);
            result = await this.ai.labelImage(frameBlob, this.customLabels);
        } else {
            result = await this.ai.labelImage(file, this.customLabels);
        }
        
        metadata = await this.fs.extractMetadata(file, fileInfo.name);

        this.appState.processedFiles.set(fileInfo.name, {
            labels: result.results.map(r => r.label),
            allResults: result.results,
            topLabel: result.top.label,
            confidence: result.top.score,
            originalPath: fileInfo.path,
            handle: fileInfo.handle,
            date: metadata.date,
            make: metadata.make,
            model: metadata.model,
            thumbnailBlob: isVideo ? frameBlob : null,
            isVideo: isVideo
        });

        const msg = `Labeled ${fileInfo.name} as ${result.top.label} (${(result.top.score * 100).toFixed(1)}%)`;
        this.ui.addLogEntry(msg);
    }

    handleProcessError(fileInfo, err) {
        this.appState.processedFiles.set(fileInfo.name, {
            labels: ['unknown'],
            allResults: [],
            topLabel: 'unknown',
            confidence: 0,
            originalPath: fileInfo.path,
            handle: fileInfo.handle,
            date: null,
            thumbnailBlob: null,
            isVideo: fileInfo.name.match(/\.(mp4|mov)$/i)
        });
        const msg = `Error labeling ${fileInfo.name}: ${err.message}`;
        this.ui.updateStatus('label-status', msg);
        this.ui.addLogEntry(msg);
    }

    handleAddRule() {
        const newRule = { id: Date.now().toString(), type: 'label', field: 'primary', pattern: '.*', target: 'Organized/{label}' };
        this.config.addRule(newRule);
        this.ui.renderRules(this.config.rules);
    }

    async handleApplyChanges() {
        this.updateState('EXECUTION');
        const files = Array.from(this.appState.processedFiles.entries());

        for (let i = 0; i < files.length; i++) {
            const [name, data] = files[i];
            this.ui.updateProgress('execution-progress-bar', ((i + 1) / files.length) * 100);
            this.ui.updateStatus('execution-status', `Moving ${name}...`);

            const targetPath = this.config.calculatePath(data) || 'Unorganized';

            const moveResult = await this.fs.moveFile(data.handle, data.originalPath, targetPath);
            this.appState.transactionLog.push(moveResult);
        }

        this.ui.updateStatus('execution-status', 'Organization complete!');
    }

    handleFinishExecution() {
        this.appState.transactionLog = [];
        this.appState.processedFiles.clear();
        this.updateState('INPUT');
    }

    async handleRollback() {
        if (this.appState.transactionLog.length === 0) {
            alert('No changes to rollback.');
            return;
        }

        this.updateState('EXECUTION');

        try {
            this.ui.updateStatus('execution-status', `Reversing ${this.appState.transactionLog.length} changes...`);
            await this.fs.rollback(this.appState.transactionLog);

            this.ui.updateStatus('execution-status', 'Rollback complete!');
            this.appState.transactionLog = [];
        } catch (err) {
            this.ui.updateStatus('execution-status', `Rollback failed: ${err.message}`);
            console.error(err);
        }

        setTimeout(() => this.updateState('PREVIEW'), 2000);
    }

    handleLoadPreset(presetId) {
        let rules = [];
        switch (presetId) {
            case 'date-label':
                rules = [
                    { id: '1', type: 'label', pattern: '.*', target: 'Organized/{label}/{year}' }
                ];
                break;
            case 'camera-model':
                rules = [
                    { id: '1', type: 'label', pattern: '.*', target: 'Equipment/{make}/{model}/{year}' }
                ];
                break;
            case 'simple-label':
                rules = [
                    { id: '1', type: 'label', pattern: '.*', target: '{label}' }
                ];
                break;
            default:
                return;
        }
        this.config.saveRules(rules);
        this.ui.renderRules(rules);
    }
}

window.app = new LocalSortApp();
