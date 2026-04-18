/**
 * fs-manager.js - File System Access API Logic
 */

export class FSManager {
    constructor() {
        this.rootHandle = null;
    }

    async selectDirectory() {
        this.rootHandle = await window.showDirectoryPicker({
            mode: 'readwrite'
        });
        return this.rootHandle;
    }

    /**
     * Extracts the EXIF DateTimeOriginal tag from a JPEG file.
     * @param {Blob} blob The image blob
     * @returns {Promise<Date|null>} The extracted date or null
     */
    /**
     * Extracts EXIF metadata (Date, Make, Model) from a JPEG file.
     * @param {Blob} blob The image blob
     * @returns {Promise<Object>} Metadata object
     */
    async extractMetadata(blob) {
        const metadata = { date: null, make: 'Unknown', model: 'Unknown' };
        try {
            const buffer = await blob.slice(0, 128 * 1024).arrayBuffer();
            const view = new DataView(buffer);

            if (view.getUint16(0) !== 0xFFD8) return metadata;

            let offset = 2;
            while (offset + 4 < view.byteLength) {
                const marker = view.getUint16(offset);
                if (marker === 0xFFE1) {
                    const segmentLength = view.getUint16(offset + 2);
                    if (view.getUint32(offset + 4, false) === 0x45584946) {
                        const tiffOffset = offset + 10;
                        const isLittleEndian = view.getUint16(tiffOffset) === 0x4949;
                        const ifdOffset = view.getUint32(tiffOffset + 4, isLittleEndian);
                        
                        this.parseIFD(view, tiffOffset, ifdOffset, isLittleEndian, metadata);
                    }
                    offset += 2 + segmentLength;
                } else {
                    offset += 2 + view.getUint16(offset + 2);
                }
            }
        } catch (e) {
            console.warn('Metadata extraction failed:', e);
        }
        return metadata;
    }

    parseIFD(view, tiffOffset, ifdOffset, isLittleEndian, metadata) {
        const ifdStart = tiffOffset + ifdOffset;
        if (ifdStart + 2 > view.byteLength) return;
        
        const numEntries = view.getUint16(ifdStart, isLittleEndian);

        for (let i = 0; i < numEntries; i++) {
            const entryOffset = ifdStart + 2 + (i * 12);
            if (entryOffset + 12 > view.byteLength) break;
            const tag = view.getUint16(entryOffset, isLittleEndian);
            
            if (tag === 0x010F) { // Make
                metadata.make = this.readExifString(view, tiffOffset, entryOffset, isLittleEndian);
            } else if (tag === 0x0110) { // Model
                metadata.model = this.readExifString(view, tiffOffset, entryOffset, isLittleEndian);
            } else if (tag === 0x8769) { // Exif IFD Pointer
                const exifOffset = view.getUint32(entryOffset + 8, isLittleEndian);
                this.parseIFD(view, tiffOffset, exifOffset, isLittleEndian, metadata);
            } else if (tag === 0x9003) { // DateTimeOriginal
                const dateStr = this.readExifString(view, tiffOffset, entryOffset, isLittleEndian, 19);
                const parts = dateStr.split(/[: ]/);
                if (parts.length >= 6) {
                    metadata.date = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
                }
            }
        }
    }

    readExifString(view, tiffOffset, entryOffset, isLittleEndian, fixedLength = null) {
        const count = view.getUint32(entryOffset + 4, isLittleEndian);
        const valueOffset = view.getUint32(entryOffset + 8, isLittleEndian);
        const dataOffset = count <= 4 ? entryOffset + 8 : tiffOffset + valueOffset;
        
        let str = '';
        const len = fixedLength || count;
        for (let j = 0; j < len; j++) {
            if (dataOffset + j >= view.byteLength) break;
            const charCode = view.getUint8(dataOffset + j);
            if (charCode === 0) break; // Null terminator
            str += String.fromCharCode(charCode);
        }
        return str.trim();
    }

    async scanDirectory(handle, path = '') {
        const files = [];
        for await (const entry of handle.values()) {
            const currentPath = path ? `${path}/${entry.name}` : entry.name;
            if (entry.kind === 'directory') {
                const subFiles = await this.scanDirectory(entry, currentPath);
                files.push(...subFiles);
            } else {
                files.push({
                    handle: entry,
                    path: currentPath,
                    name: entry.name
                });
            }
        }
        return files;
    }

    async moveFile(sourceHandle, sourcePath, targetPath) {
        if (!targetPath || targetPath.trim() === "" || targetPath === sourcePath) {
            return { sourcePath, targetPath: sourcePath, status: 'skipped' };
        }
        const targetDir = await this.ensureDirectoryPath(this.rootHandle, targetPath);

        const sourceFile = await sourceHandle.getFile();
        const content = await sourceFile.arrayBuffer();

        const fileName = sourceHandle.name;
        
        const newFileHandle = await targetDir.getFileHandle(fileName, { create: true });
        const writable = await newFileHandle.createWritable();
        await writable.write(content);
        await writable.close();

        const normalizedSource = sourcePath.replace(/\\/g, '/');
        const destinationPath = targetPath ? `${targetPath}/${fileName}` : fileName;
        
        if (normalizedSource !== destinationPath) {
            await sourceHandle.remove({ recursive: false });
        }

        return { sourcePath, targetPath: destinationPath };
    }

    async ensureDirectoryPath(rootHandle, path) {
        const parts = path.split('/');
        let currentHandle = rootHandle;

        for (const part of parts) {
            if (!part) continue;
            currentHandle = await currentHandle.getDirectoryHandle(part, { create: true });
        }
        return currentHandle;
    }

    async getDirectoryHandleByPath(rootHandle, path) {
        if (!path) return rootHandle;
        const parts = path.split('/');
        let currentHandle = rootHandle;

        for (const part of parts) {
            if (!part) continue;
            currentHandle = await currentHandle.getDirectoryHandle(part);
        }
        return currentHandle;
    }

    async rollback(transactionLog) {
        for (let i = transactionLog.length - 1; i >= 0; i--) {
            const entry = transactionLog[i];
            try {
                const targetHandle = await this.getFileHandleByPath(this.rootHandle, entry.targetPath);
                const lastSlash = entry.sourcePath.lastIndexOf('/');
                const originalFolderPath = lastSlash === -1 ? '' : entry.sourcePath.substring(0, lastSlash);

                await this.moveFile(targetHandle, entry.targetPath, originalFolderPath);
            } catch (err) {
                console.error(`Failed to rollback ${entry.targetPath}:`, err);
            }
        }
    }

    async getFileHandleByPath(rootHandle, path) {
        const parts = path.split('/');
        const fileName = parts.pop();
        const dirPath = parts.join('/');
        const dirHandle = await this.getDirectoryHandleByPath(rootHandle, dirPath);
        return await dirHandle.getFileHandle(fileName);
    }
}
