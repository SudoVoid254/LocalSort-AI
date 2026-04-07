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
        const targetDir = await this.ensureDirectoryPath(this.rootHandle, targetPath);

        const sourceFile = await sourceHandle.getFile();
        const content = await sourceFile.arrayBuffer();

        const fileName = sourceHandle.name;
        const newFileHandle = await targetDir.getFileHandle(fileName, { create: true });
        const writable = await newFileHandle.createWritable();
        await writable.write(content);
        await writable.close();

        await sourceHandle.remove({ recursive: false });

        return { sourcePath, targetPath: targetPath.endsWith('/') ? `${targetPath}${fileName}` : `${targetPath}/${fileName}` };
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
            
            const targetHandle = await this.getFileHandleByPath(this.rootHandle, entry.targetPath);
            
            const lastSlash = entry.sourcePath.lastIndexOf('/');
            const originalFolderPath = lastSlash === -1 ? '' : entry.sourcePath.substring(0, lastSlash);

            await this.moveFile(
                targetHandle,
                entry.targetPath,
                originalFolderPath
            );
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
