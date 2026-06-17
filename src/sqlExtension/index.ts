import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Returns the exact absolute path of the pre-built library 
 * matching the user's current platform and CPU architecture.
 */
function getPlatformLib() {
    const extPath = import.meta.dirname;
    const platform = process.platform; // 'darwin', 'linux', 'win32'
    const arch = os.arch();            // 'x64', 'arm64'

    let mappedPlatform = platform === "win32" ? "windows" : platform;
    let ext = platform === "linux" ? ".so" : platform === "darwin" ? ".dylib" : ".dll";

    // Matches the exact names from your cross-compilation target list
    const binaryName = `stmt_stats_ext-${mappedPlatform}-${arch}${ext}`;

    return path.join(extPath, "bin", binaryName);
}

/**
 * Resolves the extension library
 */
export function getExt() {
    const lib = getPlatformLib();

    if (fs.existsSync(lib)) {
        return lib;
    } else {
        throw new Error("Ext was not built for your platform ;(")
    }
}
