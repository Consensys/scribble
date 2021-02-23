import {
    SourceUnit,
    SrcRangeMap,
    ParameterList,
    ContractDefinition,
    FunctionDefinition,
    VariableDeclaration,
    CompileResult,
    StructuredDocumentation
} from "solc-typed-ast";
import { assert, PropertyMetaData } from "..";
import { InstrumentationContext } from "../instrumenter/instrumentation_context";
import { Range } from "../spec-lang/ast";

type TargetType = "function" | "variable" | "contract";
interface PropertyDesc {
    id: number;
    contract: string;
    filename: string;
    propertySource: string;
    annotationSource: string;
    target: TargetType;
    targetName: string;
    debugEventSignature: string;
    message: string;
}
export type PropertyMap = PropertyDesc[];
export type SrcMapToSrcMap = { entries: Array<[string, string]>; sourceList: string[] };

export type SrcTriple = [number, number, number];
export function parseSrcTriple(src: string): SrcTriple {
    return src.split(":").map((sNum) => Number.parseInt(sNum)) as SrcTriple;
}

export function ppSrcTripple(src: SrcTriple): string {
    return `${src[0]}:${src[1]}:${src[2]}`;
}

/**
 * Returns true IFF the source range a contains the source range b.
 * @param a
 * @param b
 */
export function contains(a: SrcTriple | string, b: SrcTriple | string): boolean {
    if (typeof a === "string") {
        a = parseSrcTriple(a);
    }

    if (typeof b === "string") {
        b = parseSrcTriple(b);
    }

    return a[2] == b[2] && a[0] <= b[0] && a[0] + a[1] >= b[0] + b[1];
}

export function reNumber(src: string, to: number): string {
    const t = parseSrcTriple(src);
    t[2] = to;
    return ppSrcTripple(t);
}

export function generateSrcMap2SrcMap(
    ctx: InstrumentationContext,
    sortedUnits: SourceUnit[],
    newSrcMap: SrcRangeMap
): SrcMapToSrcMap {
    const res: SrcMapToSrcMap = { entries: [], sourceList: [] };

    res.sourceList = sortedUnits.map((unit) => unit.absolutePath);

    for (const unit of sortedUnits) {
        const newSrcListIdx = res.sourceList.indexOf(unit.absolutePath);
        unit.walkChildren((node) => {
            // Skip new nodes
            if (node.src === "0:0:0") {
                return;
            }

            // Skip structured documentation in instrumented code - its not executable
            // and causes annyoing failures in src2srcmap.spec.ts
            if (node instanceof StructuredDocumentation) {
                return;
            }

            const originalSrc = reNumber(node.src, newSrcListIdx);
            const newSrc = newSrcMap.get(node);

            if (newSrc === undefined) {
                assert(
                    node instanceof ParameterList && node.vParameters.length == 0,
                    `Missing new source for node ${node.constructor.name}#${node.id}`
                );
                return;
            }

            res.entries.push([`${newSrc[0]}:${newSrc[1]}:0`, originalSrc]);
        });
    }

    for (const [property, assertion] of ctx.propertyEmittedAssertion) {
        const assertionSrc = newSrcMap.get(assertion);
        assert(
            assertionSrc !== undefined,
            `Missing new source for assertion of property ${property.original}`
        );

        const unitIdx = property.raw.src.split(":")[2];
        res.entries.push([
            `${assertionSrc[0]}:${assertionSrc[1]}:0`,
            `${property.annotationLoc[0]}:${property.annotationLoc[1]}:${unitIdx}`
        ]);
    }

    return res;
}

function rangeToSrc(range: Range, fileIdx: number): string {
    return `${range.start.offset}:${range.end.offset - range.start.offset}:${fileIdx}`;
}

export function generatePropertyMap(ctx: InstrumentationContext): PropertyMap {
    const result: PropertyMap = [];

    for (const annotation of ctx.annotations) {
        // Skip user functions from the property map.
        if (!(annotation instanceof PropertyMetaData)) {
            continue;
        }

        let contract: ContractDefinition;
        let targetType: TargetType;

        if (annotation.target instanceof FunctionDefinition) {
            assert(
                annotation.target.vScope instanceof ContractDefinition,
                "Instrumenting free functions is not supported yet"
            );

            contract = annotation.target.vScope;
            targetType = "function";
        } else if (annotation.target instanceof VariableDeclaration) {
            assert(
                annotation.target.vScope instanceof ContractDefinition,
                "Instrumenting is supported for state variables only"
            );

            contract = annotation.target.vScope;
            targetType = "variable";
        } else {
            contract = annotation.target;
            targetType = "contract";
        }

        const targetName = annotation.targetName;
        const filename = contract.vScope.sourceEntryKey;

        const unit = contract.vScope;
        const predRange = annotation.predicateFileLoc;
        const annotationRange = annotation.annotationFileRange;
        const debugEvent = ctx.debugEventDefs.get(annotation.id);
        const signature = debugEvent !== undefined ? debugEvent.canonicalSignature : "";
        const propertySource = rangeToSrc(predRange, unit.sourceListIndex);
        const annotationSource = rangeToSrc(annotationRange, unit.sourceListIndex);

        result.push({
            id: annotation.id,
            contract: contract.name,
            filename,
            propertySource,
            annotationSource,
            target: targetType,
            targetName,
            debugEventSignature: signature,
            message: annotation.message
        });
    }

    return result;
}

function stripSourcemaps(contractJSON: any): void {
    for (const unitName in contractJSON) {
        for (const contractName in contractJSON[unitName]) {
            const compiledArtifact = contractJSON[unitName][contractName];

            for (const bytecodeType in ["bytecode", "deployedBytecode"]) {
                if ("evm" in compiledArtifact && bytecodeType in compiledArtifact.evm) {
                    compiledArtifact.evm[bytecodeType].sourceMap = "";
                }
            }
        }
    }
}

/**
 * Add the actual source code to the compiled artifcat's AST data
 */
function addSrcToContext(r: CompileResult): any {
    for (const [fileName] of Object.entries(r.data["sources"])) {
        r.data["sources"][fileName]["source"] = r.files.get(fileName);
    }

    return r.data["sources"];
}

export function buildOutputJSON(
    ctx: InstrumentationContext,
    flatCompiled: CompileResult,
    sortedUnits: SourceUnit[],
    newSrcMap: SrcRangeMap
): any {
    const result: any = {};

    if ("errors" in flatCompiled.data) {
        result["errors"] = flatCompiled.data.errors;
    }

    result["sources"] = addSrcToContext(flatCompiled);

    stripSourcemaps(flatCompiled.data["contracts"]);

    result["contracts"] = flatCompiled.data["contracts"];
    result["propertyMap"] = generatePropertyMap(ctx);
    result["srcMap2SrcMap"] = generateSrcMap2SrcMap(ctx, sortedUnits, newSrcMap);

    return result;
}
