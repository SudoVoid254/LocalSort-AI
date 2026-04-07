# 📁 LocalSort-AI 

**LocalSort-AI** is a privacy-first, browser-based media organizer that uses on-device Artificial Intelligence to categorize your photos and videos. No cloud, no uploads, no subscription—just smart sorting directly on your hardware.

---

## ✨ Key Features

* **🧠 Local AI Processing:** Powered by `Transformers.js` and the `CLIP` model. Your data never leaves your computer.
* **⚡ WebGPU Accelerated:** Uses the latest browser technology to run AI inference at lightning speeds on your GPU.
* **🎥 Video Support:** Not just for photos! Automatically extracts frames from videos to determine their content.
* **📅 EXIF Mastery:** Reads original "Date Taken" metadata from JPEG headers to ensure chronological accuracy.
* **🔄 Safety First:** Includes a **Transaction Log** and **Rollback** feature. If you don't like the new structure, you can undo the move with one click.
* **🛠 Custom Rules:** Powerful regex-based sorting. Use placeholders like `{label}`, `{year}`, and `{month}` to build your perfect folder structure.

---

## 🚀 Getting Started

### Prerequisites
* A modern, Chromium-based browser (Chrome, Edge, or Brave).
* **WebGPU Support:** Ensure your browser is up to date (Chrome 113+ recommended).

### Usage
1.  **Select Folder:** Grant the app permission to access your local media directory.
2.  **AI Labeling:** Wait for the local model to analyze your files. You'll see a progress bar indicating the AI's "thought" process.
3.  **Configure Rules:** * Example: `Organized/{label}/{year}` will sort a photo of a dog taken in 2023 into `/Organized/dog/2023/photo.jpg`.
4.  **Preview:** Review the proposed folder tree before any files are moved.
5.  **Apply:** Execute the organization.

---

## 🛠 Technical Architecture

* **Core Logic:** Vanilla JavaScript (ES6 Modules)
* **AI Engine:** [Transformers.js](https://github.com/xenova/transformers.js) (CLIP-ViT-B-32)
* **File Handling:** [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)
* **Threading:** Web Workers to keep the UI responsive during heavy inference.

---

## 🔒 Privacy & Security

LocalSort-AI operates on a **Zero-Knowledge** architecture:
1.  **No Server:** There is no backend. The "App" is a static set of files.
2.  **No Tracking:** No analytics or telemetry are included.
3.  **Direct Access:** Files are read and moved locally using browser-standard handles.

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.

---

**Note:** *This tool moves files. While a rollback feature is included, it is always recommended to have a fresh backup of your media before performing bulk operations.*
