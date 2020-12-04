import {
    ASTNodeFactory,
    ASTWriter,
    DefaultASTWriterMapping,
    ExportedSymbol,
    ImportDirective,
    PrettyFormatter,
    SourceUnit,
    SymbolAlias
} from "@consensys/solc-typed-ast";
import { ImportDirectiveDesc } from "./rewriter/import_directive_header";
import { parse as parseImportDirective } from "./rewriter/import_directive_parser";
import { assert } from "./util/misc";

/**
 * Find an import named `name` imported from source unit `from`. This will
 * recursively look through `from`'s imports, in case they re-export `name`.
 *
 * It handles 4 cases:
 *  `from` defines `name` inside
 *  `from` contains a `import 'A'` which imports all symbols from A, and `name` is defined in A
 *  `from` contains a `import { name } from 'A' - which imports only `name` from A.
 *  `from` contains a `import { foo as name } from 'A' which imports foo and renames it to `name`
 *
 * @param name - name of symbol we are looking from
 * @param from - source unit from which `name` is being imported
 * @param sources - map from absolute paths to source codes
 */
export function findImport(
    name: string,
    from: SourceUnit,
    sources: Map<string, string>
): ExportedSymbol | undefined {
    if (from.vExportedSymbols.has(name)) {
        return from.vExportedSymbols.get(name);
    }

    // rewriteImports is idempotent. This is a little inefficient,
    // but shouldn't cause too much trouble atm.
    rewriteImports(from, sources);

    // Check if `from` re-exports `name`
    for (const importDir of from.vImportDirectives) {
        if (importDir.vSymbolAliases.length === 0) {
            const importee = findImport(name, importDir.vSourceUnit, sources);

            if (importee !== undefined) {
                return importee;
            }
        } else {
            for (const [origin, alias] of importDir.vSymbolAliases) {
                if (origin instanceof ImportDirective) {
                    /**
                     * @todo Handle reexported import directives properly
                     */
                    continue;
                }

                if ((alias !== undefined && alias === name) || origin.name === name) {
                    return origin;
                }
            }
        }
    }

    return undefined;
}

/**
 * In the case where `sourceUnit` was compiled by an older compiler version,
 * with invalid id's for imported symbols inside `ImportDirecive.symbolAliases`,
 * `sourceUnit.vSymbolAliases` will be invalid. This function uses a separate
 * import parser to fill-in the valid `sourceUnit.vSymbolAliases`
 *
 * @param sourceUnit - source unit for which to re-write the imports.
 * @param sources - map from absolute paths to source codes
 */
export function rewriteImports(sourceUnit: SourceUnit, sources: Map<string, string>): void {
    for (const importDir of sourceUnit.vImportDirectives) {
        if (importDir.symbolAliases.length === 0) {
            continue;
        }

        if (importDir.vSymbolAliases.length === importDir.symbolAliases.length) {
            continue; // vSymbols successfully parsed
        }

        const importedUnit = importDir.vSourceUnit;
        const source = sources.get(sourceUnit.absolutePath);

        assert(source !== undefined, `Missing source for ${sourceUnit.absolutePath}`);

        const importDirSrc = importDir.extractSourceFragment(source);
        const importDesc: ImportDirectiveDesc = parseImportDirective(importDirSrc);

        assert(importDesc.symbolAliases.length === importDir.symbolAliases.length, ``);

        const factory = new ASTNodeFactory(sourceUnit.context);

        const newSymbolAliases: SymbolAlias[] = [];

        for (const symDesc of importDesc.symbolAliases) {
            const sym = findImport(symDesc.name, importedUnit, sources);

            assert(
                sym !== undefined,
                `Sym ${symDesc.name} not found in exports of ${importedUnit.sourceEntryKey}`
            );

            if (sym instanceof ImportDirective) {
                /**
                 * @todo Handle reexported import directives properly
                 */
                continue;
            }

            const id = factory.makeIdentifierFor(sym);

            id.parent = importDir;

            newSymbolAliases.push({ foreign: id, local: symDesc.alias });
        }

        importDir.symbolAliases = newSymbolAliases;
    }
}

const writerCache = new Map<string, ASTWriter>();

function getWriter(targetCompilerVersion: string): ASTWriter {
    const cached = writerCache.get(targetCompilerVersion);

    if (cached) {
        return cached;
    }

    const formatter = new PrettyFormatter(4);
    const writer = new ASTWriter(DefaultASTWriterMapping, formatter, targetCompilerVersion);
    writerCache.set(targetCompilerVersion, writer);

    return writer;
}
/**
 * Print a list of SourceUnits, with potentially different versions and ASTContext's
 *
 * @param sourceUnits
 * @param factoryMap
 * @param targetCompilerVersion
 * @param skipImportRewriting
 */
export function print(
    sourceUnits: SourceUnit[],
    versionMap: Map<SourceUnit, string>
): Map<SourceUnit, string> {
    return new Map(
        sourceUnits.map((unit) => [unit, getWriter(versionMap.get(unit) as string).write(unit)])
    );
}
