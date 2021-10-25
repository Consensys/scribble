import fse from "fs-extra";
import path from "path";

export function searchRecursive(directory: string, filter: (entry: string) => boolean): string[] {
    const results: string[] = [];

    for (const entry of fse.readdirSync(directory)) {
        const resolvedEntry = path.resolve(directory, entry);
        const stat = fse.statSync(resolvedEntry);

        if (stat.isDirectory()) {
            results.push(...searchRecursive(resolvedEntry, filter));
        } else if (stat.isFile() && filter(resolvedEntry)) {
            results.push(resolvedEntry);
        }
    }

    return results;
}
