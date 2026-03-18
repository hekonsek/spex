import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
async function pathExists(path) {
    try {
        await stat(path);
        return true;
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}
export function getPackagesCacheDirectory() {
    return resolve(homedir(), ".cache", "spex", "packages");
}
export function getCachedPackageRepositoryMirrorPath(repository) {
    return resolve(getPackagesCacheDirectory(), repository.host, repository.namespace, `${repository.name}.git`);
}
export async function ensureCachedPackageRepositoryMirror(repository, cwd) {
    const cacheRepositoryPath = getCachedPackageRepositoryMirrorPath(repository);
    await mkdir(dirname(cacheRepositoryPath), { recursive: true });
    if (!(await pathExists(cacheRepositoryPath))) {
        await execFileAsync("git", ["clone", "--mirror", "--quiet", repository.cloneUrl, cacheRepositoryPath], {
            cwd,
            maxBuffer: 10 * 1024 * 1024,
        });
        return cacheRepositoryPath;
    }
    await execFileAsync("git", ["remote", "set-url", "origin", repository.cloneUrl], {
        cwd: cacheRepositoryPath,
        maxBuffer: 1024 * 1024,
    });
    await execFileAsync("git", ["fetch", "--quiet", "--prune", "origin"], {
        cwd: cacheRepositoryPath,
        maxBuffer: 10 * 1024 * 1024,
    });
    return cacheRepositoryPath;
}
