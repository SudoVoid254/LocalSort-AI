/**
 * zip-manager.js - Orchestrates ZIP creation
 */

export class ZipManager {
    constructor() {
        this.zip = new JSZip();
    }

    async addFile(targetPath, fileHandle) {
        const file = await fileHandle.getFile();
        // targetPath should be like "Organized/Nature/image.jpg"
        this.zip.file(targetPath, file);
    }

    async generate(onProgress) {
        return await this.zip.generateAsync({ 
            type: "blob",
            compression: "STORE" // Faster for media files
        }, (metadata) => {
            if (onProgress) onProgress(metadata.percent);
        });
    }

    download(blob, filename = "Organized_Media.zip") {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}
