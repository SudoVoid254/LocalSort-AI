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
        // Current Structure
        const currentTree = {};
        for (const [name, data] of this.appState.processedFiles.entries()) {
            this.addToTree(currentTree, data.originalPath, name);
        }
        this.ui.renderTree('current-tree', currentTree);

        // Proposed Structure
        const proposedTree = {};
        for (const [name, data] of this.appState.processedFiles.entries()) {
            const targetPath = this.config.calculatePath(data);
            if (targetPath) {
                this.addToTree(proposedTree, targetPath, name);
            } else {
                this.addToTree(proposedTree, 'Unorganized', name);
            }
        }
        this.ui.renderTree('proposed-tree', proposedTree);
    }

    addToTree(tree, path, fileName) {
        const parts = path.split('/');
        let current = tree;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (!part) continue;
            if (i === parts.length - 1) {
                // It's the leaf directory or the file's target folder
                if (!current[part]) current[part] = { type: 'directory', children: {} };
                current[part].children[fileName] = { type: 'file' };
            } else {
                if (!current[part]) current[part] = { type: 'directory', children: {} };
                current = current[part].children;
            }
        }
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

        for (let i = 0; i < files.length; i++) {
            const fileInfo = files[i];
            this.ui.updateProgress('label-progress-bar', ((i + 1) / files.length) * 100);

            // Visual feedback for the user: showing current file and its label as it happens
            this.ui.updateStatus('label-status', `Analyzing ${fileInfo.name}...`);

            try {
                const file = await fileInfo.handle.getFile();

                // CLIP cannot decode video files directly. We should only pass images.
                if (fileInfo.name.match(/\.(mp4|mov)$/i)) {
                    this.appState.processedFiles.set(fileInfo.name, {
                        labels: ['video'],
                        originalPath: fileInfo.path,
                        handle: fileInfo.handle
                    });
                    this.ui.updateStatus('label-status', `Skipped ${fileInfo.name}: Video file`);
                    continue;
                }

                const result = await this.ai.labelImage(file);

                this.appState.processedFiles.set(fileInfo.name, {
                    labels: [result.label],
                    originalPath: fileInfo.path,
                    handle: fileInfo.handle
                });
                this.ui.updateStatus('label-status', `Labeled ${fileInfo.name} as ${result.label}`);
            } catch (err) {
                console.error(`Failed to label ${fileInfo.name}:`, err);
                this.appState.processedFiles.set(fileInfo.name, {
                    labels: ['unknown'],
                    originalPath: fileInfo.path,
                    handle: fileInfo.handle
                });
                this.ui.updateStatus('label-status', `Error labeling ${fileInfo.name}`);
            }
            // Brief pause to make the UI feedback readable
            await new Promise(r => setTimeout(r, 100));
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

            const targetPath = this.config.calculatePath(data);
            if (targetPath) {
                const moveResult = await this.fs.moveFile(data.handle, data.originalPath, targetPath);
                this.appState.transactionLog.push(moveResult);
            }
        }

        this.ui.updateStatus('execution-status', 'Organization complete!');
        setTimeout(() => {
            this.appState.transactionLog = [];
            this.appState.processedFiles.clear();
            this.updateState('INPUT');
        }, 3000);
    }

    async handleRollback() {
        if (this.appState.transactionLog.length === 0) {
            alert('No changes to rollback.');
            return;
        }

        this.updateState('EXECUTION');
        const log = this.appState.transactionLog;

        for (let i = 0; i < log.length; i++) {
            const entry = log[i];
            this.ui.updateProgress('execution-progress-bar', ((i + 1) / log.length) * 100);
            this.ui.updateStatus('execution-status', `Restoring ${entry.targetPath}...`);

            await this.fs.rollback([entry]);
        }

        this.ui.updateStatus('execution-status', 'Rollback complete!');
        this.appState.transactionLog = [];
        setTimeout(() => this.updateState('INPUT'), 3000);
    }
}

window.app = new LocalSortApp();
