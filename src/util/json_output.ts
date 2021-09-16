import {
    SourceUnit,
    SrcRangeMap,
    ParameterList,
    ContractDefinition,
    FunctionDefinition,
    VariableDeclaration,
    CompileResult,
    StructuredDocumentation,
    ASTNode,
    PragmaDirective
} from "solc-typed-ast";
import { PropertyMetaData } from "../instrumenter/annotations";
import { InstrumentationContext } from "../instrumenter/instrumentation_context";
import { dedup, assert, pp } from ".";
import { DbgIdsMap } from "../instrumenter/transpiling_context";
import { getOr, rangeToOffsetRange, rangeToSrcTriple, SrcTriple } from "..";

type TargetType = "function" | "variable" | "contract" | "statement";

interface PropertyDesc {
    id: number;
    contract: string;
    filename: string;
    propertySource: string;
    annotationSource: string;
    target: TargetType;
    targetName: string;
    debugEventEncoding: Array<[string[], string]>;
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
    changedUnits: SourceUnit[],
    newSrcMap: SrcRangeMap,
    instrSourceList: string[]
): [SrcToSrcMap, string[]] {
    const src2SrcMap: SrcToSrcMap = [];
    const otherInstrumentation = [];

    for (const unit of changedUnits) {
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

            const newSrc = newSrcMap.get(node);

            if (newSrc === undefined) {
                assert(
                    (node instanceof ParameterList && node.vParameters.length == 0) ||
                        node instanceof PragmaDirective,
                    `Missing new source for node ${node.constructor.name}#${node.id}`
                );

                return;
            }

            const instrFileIdx = getInstrFileIdx(unit, ctx.outputMode, instrSourceList);

            src2SrcMap.push([`${newSrc[0]}:${newSrc[1]}:${instrFileIdx}`, node.src]);
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

            src2SrcMap.push([
                `${assertionSrc[0]}:${assertionSrc[1]}:${instrFileIdx}`,
                ppSrcTripple(property.annotationLoc)
            ]);
        }
    }

    for (const node of ctx.generalInstrumentationNodes) {
        const nodeSrc = newSrcMap.get(node);

        if (nodeSrc === undefined) {
            assert(
                nodeSrc !== undefined,
                `Missing new source for general instrumentation node ${pp(node)}`
            );
        }

        const instrFileIdx = getInstrFileIdx(node, ctx.outputMode, instrSourceList);
        otherInstrumentation.push(`${nodeSrc[0]}:${nodeSrc[1]}:${instrFileIdx}`);
    }

    return [src2SrcMap, dedup(otherInstrumentation)];
}

function generatePropertyMap(
    ctx: InstrumentationContext,
    newSrcMap: SrcRangeMap,
    instrSourceList: string[]
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
        } else if (annotation.target instanceof ContractDefinition) {
            contract = annotation.target;
            targetType = "contract";
        } else {
            contract = annotation.target.getClosestParentByType(
                ContractDefinition
            ) as ContractDefinition;
            targetType = "statement";
        }

        const targetName = annotation.targetName;
        const filename = annotation.originalFileName;

        const predRange = annotation.predicateFileLoc;
        const annotationRange = annotation.annotationFileRange;

        const encodingData = ctx.debugEventsEncoding.get(annotation.id);
        const encoding: DbgIdsMap = encodingData !== undefined ? encodingData : new DbgIdsMap();

        const srcEncoding: Array<[string[], string]> = [];
        for (const [, [ids, , type]] of encoding.entries()) {
            const srcMapList: string[] = [];
            for (const id of ids) {
                const src = ctx.files.get(filename);
                assert(
                    src !== undefined,
                    `The file ${filename} does not exist in the InstrumentationContext`
                );
                const range = annotation.annotOffToFileLoc(rangeToOffsetRange(id.requiredSrc), src);
                srcMapList.push(`${range.start.offset}:${range.end.offset - range.start.offset}:0`);
            }
            srcEncoding.push([srcMapList, type.pp()]);
        }

        const propertySource = ppSrcTripple(
            rangeToSrcTriple(predRange, annotation.annotationLoc[2])
        );
        const annotationSource = ppSrcTripple(
            rangeToSrcTriple(annotationRange, annotation.annotationLoc[2])
        );

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
            debugEventEncoding: srcEncoding,
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
    changedUnits: SourceUnit[],
    arm: boolean,
    scribbleVersion: string,
    outputFile?: string
): InstrumentationMetaData {
    let originalSourceList: string[] = originalUnits.map((unit) => unit.absolutePath);

    let instrSourceList: string[];

    if (ctx.outputMode === "files") {
        instrSourceList = changedUnits.map((unit) => unit.absolutePath);
    } else {
        assert(outputFile !== undefined, `Must provide output file in ${ctx.outputMode} mode`);

        instrSourceList = [outputFile];
    }

    const [src2srcMap, otherInstrumentation] = generateSrcMap2SrcMap(
        ctx,
        changedUnits,
        newSrcMap,
        instrSourceList
    );

    const propertyMap = generatePropertyMap(ctx, newSrcMap, instrSourceList);

    instrSourceList = instrSourceList.map((name) =>
        name === "--" || (ctx.outputMode === "files" && name === ctx.utilsUnit.absolutePath)
            ? name
            : name + ".instrumented"
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
    allUnits: SourceUnit[],
    changedUnits: SourceUnit[],
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
        allUnits,
        changedUnits,
        arm,
        scribbleVersion,
        outputFile
    );

    return result;
}
