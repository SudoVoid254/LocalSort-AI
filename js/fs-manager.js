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
    async extractMetadata(file, fileName) {
        const metadata = { date: null, make: 'Unknown', model: 'Unknown' };
        
        // 1. Try to parse date from filename first (very common fallback)
        const nameDate = this.parseDateFromFilename(fileName);
        if (nameDate) metadata.date = nameDate;

        try {
            const buffer = await file.slice(0, 256 * 1024).arrayBuffer();
            const view = new DataView(buffer);

            // 2. Check for JPEG (0xFFD8)
            if (view.byteLength > 2 && view.getUint16(0) === 0xFFD8) {
                this.parseJpegMetadata(view, metadata);
            } 
            // 3. Check for HEIC/MP4/MOV
            else if (this.isIsoMediaFile(view)) {
                this.parseIsoMediaMetadata(view, metadata);
            }
        } catch (e) {
            console.warn('Metadata extraction failed:', e);
        }
        return metadata;
    }

    isIsoMediaFile(view) {
        if (view.byteLength < 12) return false;
        const type = this.readString(view, 4, 4);
        return type === 'ftyp';
    }

    parseDateFromFilename(name) {
        const patterns = [
            /(\d{4})[-_]?(\d{2})[-_]?(\d{2})/,
            /(\d{4})(\d{2})(\d{2})/
        ];
        for (const pattern of patterns) {
            const match = name.match(pattern);
            if (match) {
                const year = parseInt(match[1]);
                const month = parseInt(match[2]);
                const day = parseInt(match[3]);
                if (year > 1980 && year < 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                    return new Date(year, month - 1, day);
                }
            }
        }
        return null;
    }

    parseIsoMediaMetadata(view, metadata) {
        const brand = this.readString(view, 8, 4);
        if (brand === 'heic' || brand === 'mif1') {
            metadata.make = 'Apple';
            metadata.model = 'HEIC Image';
        } else {
            metadata.make = 'Video';
            metadata.model = 'MP4/MOV';
        }

        // Search for creation time in 'mvhd' atom
        for (let i = 0; i < Math.min(view.byteLength - 20, 1024 * 64); i++) {
            if (view.getUint32(i) === 0x6D766864) { // 'mvhd'
                const version = view.getUint8(i + 4);
                let creationTime;
                if (version === 1) {
                    creationTime = Number(view.getBigUint64(i + 12));
                } else {
                    creationTime = view.getUint32(i + 12);
                }
                const epoch1904 = new Date('1904-01-01T00:00:00Z').getTime();
                const date = new Date(epoch1904 + creationTime * 1000);
                if (date.getFullYear() > 1980) metadata.date = date;
                break;
            }
        }
    }

    parseJpegMetadata(view, metadata) {
        let offset = 2;
        while (offset + 4 < view.byteLength) {
            const marker = view.getUint16(offset);
            if (marker === 0xFFE1) {
                const segmentLength = view.getUint16(offset + 2);
                if (view.getUint32(offset + 4, false) === 0x45584946) {
                    const tiffOffset = offset + 10;
                    if (tiffOffset + 8 > view.byteLength) break;
                    
                    const isLittleEndian = view.getUint16(tiffOffset) === 0x4949;
                    const ifdOffset = view.getUint32(tiffOffset + 4, isLittleEndian);
                    this.parseIFD(view, tiffOffset, ifdOffset, isLittleEndian, metadata);
                }
                offset += 2 + segmentLength;
            } else if (marker === 0xFFDA) {
                break;
            } else {
                const jump = view.getUint16(offset + 2);
                offset += 2 + jump;
            }
        }
    }

    readString(view, offset, length) {
        let str = '';
        for (let i = 0; i < length; i++) {
            if (offset + i >= view.byteLength) break;
            str += String.fromCharCode(view.getUint8(offset + i));
        }
        return str.trim();
    }

    parseIFD(view, tiffOffset, ifdOffset, isLittleEndian, metadata, depth = 0) {
        if (depth > 5) return; // Prevent infinite loops
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
                const subIfdOffset = view.getUint32(entryOffset + 8, isLittleEndian);
                this.parseIFD(view, tiffOffset, subIfdOffset, isLittleEndian, metadata, depth + 1);
            } else if (tag === 0x9003) { // DateTimeOriginal
                const dateStr = this.readExifString(view, tiffOffset, entryOffset, isLittleEndian, 19);
                const parts = dateStr.split(/[: ]/);
                if (parts.length >= 6) {
                    const d = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
                    if (!isNaN(d.getTime())) metadata.date = d;
                }
            }
        }

        // Follow the 'Next IFD' pointer
        const nextIfdPointerOffset = ifdStart + 2 + (numEntries * 12);
        if (nextIfdPointerOffset + 4 <= view.byteLength) {
            const nextIfdOffset = view.getUint32(nextIfdPointerOffset, isLittleEndian);
            if (nextIfdOffset !== 0) {
                this.parseIFD(view, tiffOffset, nextIfdOffset, isLittleEndian, metadata, depth + 1);
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
        return str.replace(/\0/g, '').trim();
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
        const fileName = sourceHandle.name;

        try {
            const sourceFile = await sourceHandle.getFile();
            const newFileHandle = await targetDir.getFileHandle(fileName, { create: true });
            const writable = await newFileHandle.createWritable();
            
            // Stream the content to avoid loading the whole file into RAM
            await sourceFile.stream().pipeTo(writable);

            const normalizedSource = sourcePath.replace(/\\/g, '/');
            const destinationPath = targetPath ? `${targetPath}/${fileName}` : fileName;
            
            if (normalizedSource !== destinationPath) {
                await sourceHandle.remove({ recursive: false });
            }

            return { sourcePath, targetPath: destinationPath };
        } catch (err) {
            console.error(`Failed to move ${sourcePath}:`, err);
            throw err;
        }
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
