import {
    SourceUnit,
    SrcRangeMap,
    ParameterList,
    ContractDefinition,
    FunctionDefinition,
    VariableDeclaration,
    CompileResult,
    StructuredDocumentation,
    ASTNode
} from "solc-typed-ast";
import { PropertyMetaData } from "../instrumenter/annotations";
import { InstrumentationContext } from "../instrumenter/instrumentation_context";
import { Range } from "../spec-lang/ast";
import { dedup, assert, pp } from ".";
import { getOr } from "..";

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
    instrumentationRanges: string[];
    checkRanges: string[];
    assertionRanges: string[];
}

export type PropertyMap = PropertyDesc[];
export type SrcToSrcMap = Array<[string, string]>;

export type InstrumentationMetaData = {
    propertyMap: PropertyMap;
    instrToOriginalMap: SrcToSrcMap;
    otherInstrumentation: string[];
    originalSourceList: string[];
    instrSourceList: string[];
    scribbleVersion: string;
};

/**
 * Type describes a location in a source file
 * - The first element is the starting offset of code fragment.
 * - The second element is the length of the code fragment.
 * - The third element is the file index of the source file containing the fragment in the source list.
 */
export type SrcTriple = [number, number, number];
export function parseSrcTriple(src: string): SrcTriple {
    return src.split(":").map((sNum) => Number.parseInt(sNum)) as SrcTriple;
}

export function ppSrcTripple(src: SrcTriple): string {
    return `${src[0]}:${src[1]}:${src[2]}`;
}

/**
 * Returns true if and only if the source range a contains the source range b.
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

function getInstrFileIdx(
    node: ASTNode,
    mode: "files" | "flat" | "json",
    instrSourceList: string[]
): number {
    // In flat/json mode there is a single instrumented unit output
    if (mode !== "files") {
        return 0;
    }

    const unit = node instanceof SourceUnit ? node : node.getClosestParentByType(SourceUnit);
    assert(unit !== undefined, `No source unit for ${pp(node)}`);
    const idx = instrSourceList.indexOf(unit.absolutePath);
    assert(
        idx !== -1,
        `Unit ${unit.absolutePath} missing from instrumented source list ${pp(instrSourceList)}`
    );

    return idx;
}

function generateSrcMap2SrcMap(
    ctx: InstrumentationContext,
    sortedUnits: SourceUnit[],
    utilsUnit: SourceUnit,
    newSrcMap: SrcRangeMap,
    originalSourceList: string[],
    instrSourceList: string[]
): [SrcToSrcMap, string[]] {
    const src2SrcMap: SrcToSrcMap = [];
    const otherInstrumentation = [];

    for (const unit of sortedUnits) {
        const newSrcListIdx = originalSourceList.indexOf(unit.absolutePath);

        // Don't add the utils unit to the src2src map
        if (unit === utilsUnit) {
            continue;
        }

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

            const instrFileIdx = getInstrFileIdx(unit, ctx.outputMode, instrSourceList);

            src2SrcMap.push([`${newSrc[0]}:${newSrc[1]}:${instrFileIdx}`, originalSrc]);
        });
    }

    for (const [property, assertions] of ctx.instrumentedCheck) {
        for (const assertion of assertions) {
            const assertionSrc = newSrcMap.get(assertion);
            const instrFileIdx = getInstrFileIdx(assertion, ctx.outputMode, instrSourceList);

            assert(
                assertionSrc !== undefined,
                `Missing new source for assertion of property ${property.original}`
            );

            const originalFileIdx = property.raw.src.split(":")[2];

            src2SrcMap.push([
                `${assertionSrc[0]}:${assertionSrc[1]}:${instrFileIdx}`,
                `${property.annotationLoc[0]}:${property.annotationLoc[1]}:${originalFileIdx}`
            ]);
        }
    }

    for (const node of ctx.generalInstrumentationNodes) {
        const nodeSrc = newSrcMap.get(node);

        assert(
            nodeSrc !== undefined,
            `Missing new source for general instrumentation node ${pp(node)}`
        );

        const instrFileIdx = getInstrFileIdx(node, ctx.outputMode, instrSourceList);
        otherInstrumentation.push(`${nodeSrc[0]}:${nodeSrc[1]}:${instrFileIdx}`);
    }

    return [src2SrcMap, dedup(otherInstrumentation)];
}

function rangeToSrc(range: Range, fileIdx: number): string {
    return `${range.start.offset}:${range.end.offset - range.start.offset}:${fileIdx}`;
}

function generatePropertyMap(
    ctx: InstrumentationContext,
    newSrcMap: SrcRangeMap,
    instrSourceList: string[],
    originalSourceList: string[]
): PropertyMap {
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

        const newUnitIdx = originalSourceList.indexOf(unit.absolutePath);
        const propertySource = rangeToSrc(predRange, newUnitIdx);
        const annotationSource = rangeToSrc(annotationRange, newUnitIdx);

        const evalStmts = getOr(ctx.evaluationStatements, annotation, []);

        const instrumentationRanges = dedup(
            evalStmts.map((node) => {
                const src = newSrcMap.get(node);
                assert(
                    src !== undefined,
                    `Missing source for instrumentation node ${pp(node)} of annotation ${
                        annotation.original
                    }`
                );

                const instrFileIdx = getInstrFileIdx(node, ctx.outputMode, instrSourceList);
                return `${src[0]}:${src[1]}:${instrFileIdx}`;
            })
        );

        const annotationChecks = getOr(ctx.instrumentedCheck, annotation, []);
        const checkRanges: string[] = dedup(
            annotationChecks.map((check) => {
                const range = newSrcMap.get(check);
                const annotationFileIdx = getInstrFileIdx(check, ctx.outputMode, instrSourceList);

                assert(
                    range !== undefined,
                    `Missing src range for annotation check node ${pp(check)} of ${
                        annotation.original
                    }`
                );

                return `${range[0]}:${range[1]}:${annotationFileIdx}`;
            })
        );

        const failureChecks = getOr(ctx.failureCheck, annotation, []);

        const assertionRanges = dedup(
            failureChecks.map((check) => {
                const range = newSrcMap.get(check);
                const annotationFileIdx = getInstrFileIdx(check, ctx.outputMode, instrSourceList);

                assert(
                    range !== undefined,
                    `Missing src range for annotation check node ${pp(check)} of ${
                        annotation.original
                    }`
                );
                return `${range[0]}:${range[1]}:${annotationFileIdx}`;
            })
        );

        result.push({
            id: annotation.id,
            contract: contract.name,
            filename,
            propertySource,
            annotationSource,
            target: targetType,
            targetName,
            debugEventSignature: signature,
            message: annotation.message,
            instrumentationRanges,
            checkRanges,
            assertionRanges
        });
    }

    return result;
}

export function generateInstrumentationMetadata(
    ctx: InstrumentationContext,
    newSrcMap: SrcRangeMap,
    originalUnits: SourceUnit[],
    arm: boolean,
    scribbleVersion: string,
    outputFile?: string
): InstrumentationMetaData {
    const utilsUnit = ctx.utilsUnit;

    let originalSourceList: string[] = originalUnits
        .filter((unit) => unit !== utilsUnit)
        .map((unit) => unit.absolutePath);

    let instrSourceList: string[];

    if (ctx.outputMode === "files") {
        instrSourceList = [...originalSourceList, utilsUnit.absolutePath];
    } else {
        assert(outputFile !== undefined, `Must provide output file in ${ctx.outputMode} mode`);

        instrSourceList = [outputFile];
    }

    const [src2srcMap, otherInstrumentation] = generateSrcMap2SrcMap(
        ctx,
        originalUnits,
        utilsUnit,
        newSrcMap,
        originalSourceList,
        instrSourceList
    );

    const propertyMap = generatePropertyMap(ctx, newSrcMap, instrSourceList, originalSourceList);

    instrSourceList = instrSourceList.map((name) =>
        name === "--" || name === utilsUnit.absolutePath ? name : name + ".instrumented"
    );

    if (arm) {
        originalSourceList = originalSourceList.map((name) => name + ".original");
    }

    return {
        instrToOriginalMap: src2srcMap,
        otherInstrumentation,
        propertyMap,
        originalSourceList,
        instrSourceList,
        scribbleVersion
    };
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
    newSrcMap: SrcRangeMap,
    scribbleVersion: string,
    outputFile: string,
    arm: boolean
): any {
    const result: any = {};

    if ("errors" in flatCompiled.data) {
        result["errors"] = flatCompiled.data.errors;
    }

    result["sources"] = addSrcToContext(flatCompiled);
    result["contracts"] = flatCompiled.data["contracts"];
    result["instrumentationMetadata"] = generateInstrumentationMetadata(
        ctx,
        newSrcMap,
        sortedUnits,
        arm,
        scribbleVersion,
        outputFile
    );

    return result;
}
