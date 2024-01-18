import {
    assert,
    ASTNode,
    CompileResult,
    ContractDefinition,
    FunctionDefinition,
    generalizeType,
    ParameterList,
    PragmaDirective,
    SourceUnit,
    SrcRangeMap,
    StructuredDocumentation,
    bytesToString,
    VariableDeclaration
} from "solc-typed-ast";
import { Range, SrcTriple } from "./location";
import { getOr } from "./misc";
import { dedup, MacroFile } from ".";
import { PropertyMetaData, TryAnnotationMetaData } from "../instrumenter/annotations";
import { InstrumentationContext } from "../instrumenter/instrumentation_context";
import { AnnotationType } from "../spec-lang/ast/declarations/annotation";
import { NodeLocation } from "../spec-lang/ast/node";

type TargetType = "function" | "variable" | "contract" | "statement";
/// An original JSON location is either a src tripple, or a pair of src trippls (corresponding to an instantiated macro)
export type OriginalJSONLoc = string | [string, string];

/**
 * JSON interface describing an element of the `propertyMap` filed of the
 * instrumentation metadata
 */
interface PropertyDesc {
    /// Unique identifier of the property
    id: number;
    /// Name of the contract in which this property is applied (either on the contract or on an element in the countract)
    contract: string;
    /// Name of the original file where the property was written
    filename: string;
    /// Source tripple (start:len:fileIndx) in the _original_ file where just the expression of the annotation is located
    propertySource: OriginalJSONLoc;
    /// Source tripple (start:len:fileIndx) in the _original_ file where just the whole annotation is located
    annotationSource: OriginalJSONLoc;
    /// Text of the original annotation
    annotationText: string;
    /// Type of the target to which the annotation is applied (e.g contract, function, etc.)
    target: TargetType;
    /// Type of the annotation (e.g. if_succeeds, invariant, etc.)
    type: AnnotationType;
    /// Name of the target to which the property is applied
    targetName: string;
    /// A list of tuples `[locations, type]` describing what each field in the
    /// AssertionFailedData bytecode array refers to. The N-th tuple `[locations, type]`
    /// describes what the N-th value of the debug data describes. `locations` is the list of
    /// source locations in the original file to which the data applies, and `type` is the type of the data.
    debugEventEncoding: Array<[string, OriginalJSONLoc[], string]>;
    /// The user-readable message assoicated with the original annotation (if none then its "")
    message: string;
    /// List of source locations in the _instrumented_ file that are part of the instrumentation
    /// for this property
    instrumentationRanges: string[];
    /// List of locations in the _instrumented_ file that correspond to executing the check
    /// of this property. These locations can be used to check if this property has been reached
    checkRanges: string[];
    /// List of locations in the _instrumented_ file that correspond to code executed when
    /// this property has failed.
    assertionRanges: string[];
}

export type PropertyMap = PropertyDesc[];
export type SrcToSrcMap = Array<[string, OriginalJSONLoc]>;

export type InstrumentationMetaData = {
    propertyMap: PropertyMap;
    instrToOriginalMap: SrcToSrcMap;
    otherInstrumentation: string[];
    originalSourceList: string[];
    instrSourceList: string[];
    scribbleVersion: string;
};

/**
 * Convert a line/column source range into an offset range
 */
export function rangeToSrcTriple(r: Range, srcList: string[]): SrcTriple {
    const fileInd = srcList.indexOf(r.start.file.fileName);
    return [r.start.offset, r.end.offset - r.start.offset, fileInd];
}

export function nodeLocToJSONNodeLoc(n: NodeLocation, srcList: string[]): OriginalJSONLoc {
    if (n instanceof Array) {
        const macroLoc = ppSrcTripple(rangeToSrcTriple(n[0], srcList));
        const instLoc = ppSrcTripple(rangeToSrcTriple(n[1], srcList));

        return [macroLoc, instLoc];
    }

    return ppSrcTripple(rangeToSrcTriple(n, srcList));
}

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

    assert(unit !== undefined, "No source unit for {0}", node);

    const idx = instrSourceList.indexOf(unit.absolutePath);

    assert(
        idx !== -1,
        "Unit {0} missing from instrumented source list {1}",
        unit.absolutePath,
        instrSourceList
    );

    return idx;
}

function generateSrcMap2SrcMap(
    ctx: InstrumentationContext,
    changedUnits: SourceUnit[],
    newSrcMap: SrcRangeMap,
    instrSourceList: string[],
    originalSourceList: string[]
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
        const annotationLoc = nodeLocToJSONNodeLoc(
            property.parsedAnnot.src as NodeLocation,
            originalSourceList
        );

        for (const assertion of assertions) {
            const assertionSrc = newSrcMap.get(assertion);
            const instrFileIdx = getInstrFileIdx(assertion, ctx.outputMode, instrSourceList);

            assert(
                assertionSrc !== undefined,
                `Missing new source for assertion of property ${property.original}`
            );

            src2SrcMap.push([
                `${assertionSrc[0]}:${assertionSrc[1]}:${instrFileIdx}`,
                annotationLoc
            ]);
        }
    }

    for (const node of ctx.generalInstrumentationNodes) {
        const nodeSrc = newSrcMap.get(node);

        if (nodeSrc === undefined) {
            assert(
                nodeSrc !== undefined,
                "Missing new source for general instrumentation node",
                node
            );
        }

        const instrFileIdx = getInstrFileIdx(node, ctx.outputMode, instrSourceList);
        otherInstrumentation.push(`${nodeSrc[0]}:${nodeSrc[1]}:${instrFileIdx}`);
    }

    return [src2SrcMap, dedup(otherInstrumentation)];
}

/**
 * Given 1 or more NodeLocations merge them into a single location.
 * This asserts that:
 *
 * 1. We are merging like locations (either Range with Range or InstantiatedMacroLoc with InstantiatedMacroLoc)
 * 2. We are merging locations inside the same file
 *
 * When merging 2 ranges, we just return a range that encompases both. When
 * merging two InstantiatedMacroLoc, we merge each of the two ranges.
 */
function mergeNodeLocs(...locs: NodeLocation[]): NodeLocation {
    assert(locs.length > 0, `Can't merge 0 locs`);

    if (locs.length === 1) {
        return locs[0];
    }

    if (locs.length === 2) {
        const a = locs[0];
        const b = locs[1];

        if (a instanceof Array && b instanceof Array) {
            return [mergeNodeLocs(a[0], b[0]) as Range, mergeNodeLocs(a[1], b[1]) as Range];
        }

        assert(!(a instanceof Array || b instanceof Array), `Cant merge range and range pair`);
        assert(
            a.start.file === b.start.file && a.end.file === b.end.file,
            `Cant merge things from different files`
        );

        const min = (x: number, y: number) => (x <= y ? x : y);
        const max = (x: number, y: number) => (x >= y ? x : y);

        return {
            start: {
                offset: min(a.start.offset, b.start.offset),
                line: min(a.start.line, b.start.line),
                column: min(a.start.column, b.start.column),
                file: a.start.file
            },
            end: {
                offset: max(a.end.offset, b.end.offset),
                line: max(a.end.line, b.end.line),
                column: max(a.end.column, b.end.column),
                file: a.end.file
            }
        };
    }

    let res = locs[0];
    for (let i = 1; i < locs.length; i++) {
        res = mergeNodeLocs(res, locs[i]);
    }

    return res;
}

function generatePropertyMap(
    ctx: InstrumentationContext,
    newSrcMap: SrcRangeMap,
    originalSourceList: string[],
    instrSourceList: string[]
): PropertyMap {
    const result: PropertyMap = [];

    for (const annotation of ctx.annotations) {
        // Skip user functions and user constants from the property map.
        if (
            !(annotation instanceof PropertyMetaData || annotation instanceof TryAnnotationMetaData)
        ) {
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

        let encoding = ctx.debugEventsDescMap.get(annotation);
        encoding = encoding === undefined ? [] : encoding;

        const srcEncoding: Array<[string, string[], string]> = [];
        for (const [ids, type] of encoding) {
            const srcMapList: string[] = [];
            for (const id of ids) {
                const idSrc = rangeToSrcTriple(id.requiredRange, originalSourceList);
                srcMapList.push(ppSrcTripple(idSrc));
            }

            srcEncoding.push([ids[0].name, srcMapList, generalizeType(type)[0].pp()]);
        }

        let propertySource: OriginalJSONLoc;

        if (annotation instanceof PropertyMetaData) {
            propertySource = nodeLocToJSONNodeLoc(
                annotation.parsedAnnot.expression.src as NodeLocation,
                originalSourceList
            );
        } else {
            const propertyLocs = annotation.parsedAnnot.exprs.map(
                (expr) => expr.src as NodeLocation
            );

            propertySource = nodeLocToJSONNodeLoc(
                mergeNodeLocs(...propertyLocs),
                originalSourceList
            );
        }

        const annotationSource = nodeLocToJSONNodeLoc(
            annotation.parsedAnnot.src as NodeLocation,
            originalSourceList
        );

        const evalStmts = getOr(ctx.evaluationStatements, annotation, []);

        const instrumentationRanges = dedup(
            evalStmts.map((node) => {
                const src = newSrcMap.get(node);
                assert(
                    src !== undefined,
                    "Missing source for instrumentation node {0} of annotation {1}",
                    node,
                    annotation.original
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
                    "Missing src range for annotation check node {0} of {1}",
                    check,
                    annotation.original
                );

                return `${range[0]}:${range[1]}:${annotationFileIdx}`;
            })
        );

        const failureStatements = getOr(ctx.failureStatements, annotation, []);

        const failureRanges = dedup(
            failureStatements.map((check) => {
                const range = newSrcMap.get(check);
                const annotationFileIdx = getInstrFileIdx(check, ctx.outputMode, instrSourceList);

                assert(
                    range !== undefined,
                    "Missing src range for annotation check node {0} of {1}",
                    check,
                    annotation.original
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
            annotationText: annotation.original,
            target: targetType,
            type: annotation.type,
            targetName,
            debugEventEncoding: srcEncoding,
            message: annotation.message,
            instrumentationRanges,
            checkRanges,
            assertionRanges: failureRanges
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

    // Collect any macro files that were used and add them to the originalSourceList
    const macroFiles = new Set<MacroFile>(
        ctx.annotations
            .map((annot) => annot.parsedAnnot.requiredRange.start.file)
            .filter((file) => file instanceof MacroFile)
    );

    originalSourceList.push(...[...macroFiles].map((file) => file.fileName));

    let instrSourceList: string[];

    if (ctx.outputMode === "files") {
        instrSourceList = changedUnits.map((unit) => unit.absolutePath);
    } else {
        assert(outputFile !== undefined, `Must provide output file in ${ctx.outputMode} mode`);

        instrSourceList = [outputFile];
    }

    const [instrToOriginalMap, otherInstrumentation] = generateSrcMap2SrcMap(
        ctx,
        changedUnits,
        newSrcMap,
        instrSourceList,
        originalSourceList
    );

    const propertyMap = generatePropertyMap(ctx, newSrcMap, originalSourceList, instrSourceList);

    originalSourceList = originalSourceList.map((file) =>
        file.endsWith(".sol") ? ctx.getResolvedPath(file) : file
    );

    instrSourceList = instrSourceList.map((file) =>
        file.endsWith(".sol") ? ctx.getResolvedPath(file) : file
    );

    if (arm) {
        originalSourceList = originalSourceList.map((fileName) =>
            fileName.endsWith(".sol") && instrSourceList.includes(fileName)
                ? fileName + ".original"
                : fileName
        );
    }

    instrSourceList = instrSourceList.map((fileName) =>
        fileName === "--" ? fileName : fileName + ".instrumented"
    );

    return {
        instrToOriginalMap,
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
        const contentsBuf = r.files.get(fileName);
        r.data["sources"][fileName]["source"] =
            contentsBuf !== undefined ? bytesToString(contentsBuf) : undefined;
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
