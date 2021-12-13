import path from "path";
import fse from "fs-extra";

const findupSync = require("findup-sync");

function getDirIfIsFile(p: string): string {
    return fse.existsSync(p) && fse.statSync(p).isFile() ? path.dirname(p) : p;
}

export function getBasePath(paths: string[]): string {
    if (paths.length === 0) {
        throw new Error("Unable to detect base path for empty array of paths");
    }

    let base: string;

    if (paths.length === 1) {
        base = paths[0];
    } else {
        base = paths.reduce((prev, cur) => {
            let i = 0;

            while (prev[i] === cur[i]) {
                i++;
            }

            return prev.slice(0, i);
        });
    }

    return getDirIfIsFile(base);
}

/**
 * @see https://ethereum.org/en/developers/docs/frameworks/
 */
const possibleProjectRootFiles = [
    "package.json",
    "brownie-config.yaml",
    "truffle-config.js",
    "hardhat.config.js",
    "embark.json",

    /**
     * Legacy or custom cases with lower priority
     */
    "truffle.js"
];

export function detectProjectRoot(paths: string[]): string | undefined {
    const base = getBasePath(paths);
    const file = findupSync(possibleProjectRootFiles, { cwd: base });

    return file === null ? undefined : path.dirname(file);
}
