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

        // Add rollback trigger if we add a button to the UI
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
}
