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
        this.ui.init();

        // Check for File System Access API support
        if (!('showDirectoryPicker' in window)) {
            this.ui.updateStatusBar('fs-status', '❌ Browser not supported');
            alert('Your browser does not support the File System Access API. Please use a Chromium-based browser (Chrome, Edge, Brave) and ensure you are in a secure context (HTTPS). If using Brave, check your Shield settings.');
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
        // 1. Render the Thumbnail Gallery
        await this.ui.renderGallery(this.appState.processedFiles, (fileName, newLabel) => {
            const data = this.appState.processedFiles.get(fileName);
            if (data) {
                data.labels = [newLabel];
                // Re-generate tree immediately to show the impact of the change
                this.generatePreview();
            }
        });

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

    async startLabeling() {
        const files = this.appState.files.filter(f =>
            f.name.match(/\.(jpg|jpeg|png|webp|mp4|mov)$/i)
        );

        if (files.length === 0) {
            this.ui.updateStatus('label-status', 'No supported media files found.');
            setTimeout(() => this.updateState('CONFIG'), 2000);
            return;
        }

        if (!this.ai.isReady) {
            this.ui.updateStatus('label-status', 'Waiting for AI model to load...');
            await new Promise((resolve) => {
                const checkInterval = setInterval(() => {
                    if (this.ai.isReady) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 500);
            });
        }

        this.ui.updateStatusBar('ai-status', '🧠 AI: Analyzing...');
        this.ui.clearLog();

        for (let i = 0; i < files.length; i++) {
            const fileInfo = files[i];
            this.ui.updateProgress('label-progress-bar', ((i + 1) / files.length) * 100);

            this.ui.updateStatus('label-status', `Analyzing ${fileInfo.name}...`);

            try {
                const file = await fileInfo.handle.getFile();

                if (fileInfo.name.match(/\.(mp4|mov)$/i)) {
                    try {
                        const videoFile = await fileInfo.handle.getFile();
                        const frameBlob = await this.ai.extractVideoFrame(videoFile);
                        const result = await this.ai.labelImage(frameBlob, this.customLabels);

                        this.appState.processedFiles.set(fileInfo.name, {
                            labels: [result.label],
                            originalPath: fileInfo.path,
                            handle: fileInfo.handle,
                            date: null // Videos often lack standard EXIF date, fallback to file date in config-store
                        });
                        const msg = `Labeled video ${fileInfo.name} as ${result.label}`;
                        this.ui.updateStatus('label-status', msg);
                        this.ui.addLogEntry(msg);
                    } catch (err) {
                        console.error(`Failed to process video ${fileInfo.name}:`, err);
                        this.appState.processedFiles.set(fileInfo.name, {
                            labels: ['video'],
                            originalPath: fileInfo.path,
                            handle: fileInfo.handle,
                            date: null
                        });
                        this.ui.addLogEntry(`Error processing video ${fileInfo.name}: ${err.message}`);
                    }
                    continue;
                }

                const result = await this.ai.labelImage(file, this.customLabels);
                const captureDate = await this.fs.extractExifDate(file);

                this.appState.processedFiles.set(fileInfo.name, {
                    labels: [result.label],
                    originalPath: fileInfo.path,
                    handle: fileInfo.handle,
                    date: captureDate
                });
                const msg = `Labeled ${fileInfo.name} as ${result.label}`;
                this.ui.updateStatus('label-status', msg);
                this.ui.addLogEntry(msg);
            } catch (err) {
                console.error(`Failed to label ${fileInfo.name}:`, err);
                this.appState.processedFiles.set(fileInfo.name, {
                    labels: ['unknown'],
                    originalPath: fileInfo.path,
                    handle: fileInfo.handle,
                    date: null
                });
                const msg = `Error labeling ${fileInfo.name}: ${err.message}`;
                this.ui.updateStatus('label-status', msg);
                this.ui.addLogEntry(msg);
            }
            await new Promise(requestAnimationFrame);
        }

        this.ui.updateStatusBar('ai-status', '🧠 AI: Ready');
        this.updateState('CONFIG');
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
}

window.app = new LocalSortApp();
