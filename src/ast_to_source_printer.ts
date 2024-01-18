import {
    ASTNodeFactory,
    ASTWriter,
    DefaultASTWriterMapping,
    ExportedSymbol,
    ImportDirective,
    PrettyFormatter,
    SourceUnit,
    SrcRangeMap,
    SymbolAlias,
    assert,
    bytesToString,
    strUTF8Len
} from "solc-typed-ast";
import { ImportDirectiveDesc } from "./rewriter/import_directive_header";
import { parse as parseImportDirective } from "./rewriter/import_directive_parser";
import { SourceMap } from "./util/sources";

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
function findImport(
    name: string,
    from: SourceUnit,
    sources: SourceMap,
    factory: ASTNodeFactory
): ExportedSymbol | undefined {
    if (from.vExportedSymbols.has(name)) {
        return from.vExportedSymbols.get(name);
    }

    // rewriteImports is idempotent. This is a little inefficient,
    // but shouldn't cause too much trouble atm.
    rewriteImports(from, sources, factory);

    // Check if `from` re-exports `name`
    for (const importDir of from.vImportDirectives) {
        if (importDir.vSymbolAliases.length === 0 && importDir.unitAlias === "") {
            // Simple import - e.g 'import "abc.sol"'. All top-level definition from "abc.sol" are imported.
            const importee = findImport(name, importDir.vSourceUnit, sources, factory);

            if (importee !== undefined) {
                return importee;
            }
        } else if (importDir.unitAlias !== "") {
            // Unit alias import - 'import "abc.sol" as abc'. `abc` is the only identifier defined.
            if (importDir.unitAlias === name) return importDir;
        } else {
            // Individual symbols imported - 'import {A, B as C} from "abc.sol"'. Only listed definitions imported.
            for (const [origin, alias] of importDir.vSymbolAliases) {
                let impName: string;

                if (alias != undefined) {
                    impName = alias;
                } else {
                    impName = origin instanceof ImportDirective ? origin.unitAlias : origin.name;
                }

                if (impName === name) {
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
export function rewriteImports(
    sourceUnit: SourceUnit,
    sources: SourceMap,
    factory: ASTNodeFactory
): void {
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

        const importDirSrc = importDir.extractSourceFragment(source.rawContents);
        const importDesc: ImportDirectiveDesc = parseImportDirective(bytesToString(importDirSrc));

        assert(
            importDesc.symbolAliases.length === importDir.symbolAliases.length,
            "Symbol aliases length mismatch when processing {0}",
            importDir
        );

        const newSymbolAliases: SymbolAlias[] = [];

        for (const symDesc of importDesc.symbolAliases) {
            const sym = findImport(symDesc.name, importedUnit, sources, factory);

            assert(
                sym !== undefined,
                `Sym ${symDesc.name} not found in exports of ${importedUnit.sourceEntryKey}`
            );

            const id = factory.makeIdentifier("<missing>", symDesc.name, sym.id);

            id.parent = importDir;

            newSymbolAliases.push({ foreign: id, local: symDesc.alias });

            const symName = symDesc.alias !== null ? symDesc.alias : id.name;

            if (!sourceUnit.exportedSymbols.has(symName)) {
                sourceUnit.exportedSymbols.set(symName, id.referencedDeclaration);
            }
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

export function print(
    sourceUnits: SourceUnit[],
    compilerVersion: string,
    srcMap: SrcRangeMap,
    instrumentationMarker?: string
): Map<SourceUnit, string> {
    const writer = getWriter(compilerVersion);
    const result = new Map<SourceUnit, string>();
    const markerLen = instrumentationMarker === undefined ? 0 : strUTF8Len(instrumentationMarker);

    for (const unit of sourceUnits) {
        const source = writer.write(unit, srcMap);

        if (instrumentationMarker === undefined) {
            result.set(unit, source);
        } else {
            /**
             * 1. Prepend instrumentation marker message to the source
             */
            result.set(unit, instrumentationMarker + source);

            /**
             * 2. Shift OFFSET of each child node of the source unit
             */
            for (const node of unit.getChildren()) {
                const src = srcMap.get(node);

                if (src !== undefined) {
                    src[0] += markerLen;
                }
            }

            /**
             * 3. Expand source unit LENGTH
             */
            const src = srcMap.get(unit);

            if (src !== undefined) {
                src[1] += markerLen;
            }
        }
    }

    return result;
}
