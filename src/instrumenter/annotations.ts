import {
    ContractDefinition,
    ContractKind,
    FunctionDefinition,
    resolve,
    SourceUnit,
    StructuredDocumentation,
    VariableDeclaration
} from "solc-typed-ast";
import {
    AnnotationType,
    Location,
    Range,
    SAnnotation,
    SNode,
    SProperty,
    SUserFunctionDefinition
} from "../spec-lang/ast";
import { parseAnnotation, SyntaxError as ExprPEGSSyntaxError } from "../spec-lang/expr_parser";
import { getScopeUnit } from "../util/misc";

const srcLocation = require("src-location");

export type AnnotationFilterOptions = {
    type?: string;
    message?: string;
};

function indexToLocation(contents: string, ind: number): Location {
    const t = srcLocation.indexToLocation(contents, ind, true);
    return { offset: ind, line: t.line, column: t.column };
}

export function rangeToLocRange(start: number, length: number, contents: string): Range {
    return {
        start: indexToLocation(contents, start),
        end: indexToLocation(contents, start + length)
    };
}

/**
 * Convert a line/column source range into an offset range
 *
 * @param r line/column source range
 */
function rangeToOffsetRange(r: Range): OffsetRange {
    return [r.start.offset, r.end.offset - r.start.offset];
}

export type AnnotationTarget = ContractDefinition | FunctionDefinition | VariableDeclaration;
/// File byte range: [start, length]
type OffsetRange = [number, number];

function offsetBy(a: OffsetRange, b: number | OffsetRange): OffsetRange {
    const off = typeof b === "number" ? b : b[0];
    return [a[0] + off, a[1]];
}

let numAnnotations = 0;

/**
 * Base class containing metadata for parsed anntotations useful for
 * pretty-printing error messages and error line information.
 */
export class AnnotationMetaData<T extends SAnnotation = SAnnotation> {
    /// StructuredDocumentation AST node containing the annotation
    readonly raw: StructuredDocumentation;
    /// Target ast node being annotated. Either FunctionDefintion or ContractDefinition
    readonly target: AnnotationTarget;
    /// Name of target node. We need this to remember the original name, as interposing
    /// destructively changes names
    readonly targetName: string;
    /// Parsed annotation
    readonly parsedAnnot: T;

    /// User-label ("" if not provided)
    get message(): string {
        return this.parsedAnnot.label ? this.parsedAnnot.label : "";
    }
    /// Type of the annotation
    get type(): AnnotationType {
        return this.parsedAnnot.type;
    }
    /// Original annotation text
    readonly original: string;
    /// UID of this annotation
    readonly id: number;

    /// Location of the whole annotation relative to the start of the file
    readonly annotationLoc: OffsetRange;
    /**
     * The line/column location of the whole annotation (relative to the begining of the file).
     */
    readonly annotationFileRange: Range;
    /// Location of the comment containing the annotation relative to the start of the file
    readonly commentLoc: OffsetRange;
    /// Relative offset of the parsed tree to the beginning of the file
    readonly parseOff: number;

    constructor(
        raw: StructuredDocumentation,
        target: AnnotationTarget,
        originalSlice: string,
        parsedAnnot: T,
        annotationDocstringOff: number,
        source: string
    ) {
        this.raw = raw;
        this.target = target;
        // This is a hack. Remember the target name as interposing overwrites it
        this.targetName = target.name;

        this.original = parsedAnnot.getSourceFragment(originalSlice);
        this.id = numAnnotations++;
        this.parsedAnnot = parsedAnnot;
        const commentSrc = raw.sourceInfo;
        /// Location of the whole docstring containing the annotation relative to
        /// the start of the file
        this.commentLoc = [commentSrc.offset, commentSrc.length];
        this.parseOff = commentSrc.offset + annotationDocstringOff;
        /// Location of the annotation relative to the start of the file
        this.annotationLoc = offsetBy(rangeToOffsetRange(parsedAnnot.requiredSrc), this.parseOff);
        this.annotationFileRange = rangeToLocRange(
            this.annotationLoc[0],
            this.annotationLoc[1],
            source
        );
    }
}

/**
 * Metadata specific to a user function definition.
 */
export class UserFunctionDefinitionMetaData extends AnnotationMetaData<SUserFunctionDefinition> {
    /// Location of the body of the function relative to the beginning of the file
    readonly bodyLoc: OffsetRange;
    /// Parsed annotation predicate
    get body(): SNode {
        return this.parsedAnnot.body;
    }
    /**
     * The line/column location of the predicate (relative to the begining of the file)
     */
    readonly bodyFileLoc: Range;

    constructor(
        raw: StructuredDocumentation,
        target: AnnotationTarget,
        originalSlice: string,
        parsedAnnot: SUserFunctionDefinition,
        annotationDocstringOff: number,
        source: string
    ) {
        super(raw, target, originalSlice, parsedAnnot, annotationDocstringOff, source);
        // Location of the predicate relative to the begining of the file
        this.bodyLoc = offsetBy(rangeToOffsetRange(parsedAnnot.body.requiredSrc), this.parseOff);
        this.bodyFileLoc = rangeToLocRange(this.bodyLoc[0], this.bodyLoc[1], source);
    }

    /**
     * Convert a location relative to the predicate into a file-wide location
     */
    bodyOffToFileLoc(arg: OffsetRange, source: string): Range {
        const fileOff = offsetBy(arg, this.bodyLoc);

        return rangeToLocRange(fileOff[0], fileOff[1], source);
    }
}

/**
 * Metadata specific to a property annotation (invariant, if_succeeds)
 */
export class PropertyMetaData extends AnnotationMetaData<SProperty> {
    /// Parsed annotation predicate
    get expression(): SNode {
        return this.parsedAnnot.expression;
    }

    /// Location of the expression relative to the start of the file
    readonly exprLoc: OffsetRange;
    /**
     * The line/column location of the predicate (relative to the begining of the file)
     */
    predicateFileLoc: Range;

    constructor(
        raw: StructuredDocumentation,
        target: AnnotationTarget,
        originalSlice: string,
        parsedAnnot: SProperty,
        annotationDocstringOff: number,
        source: string
    ) {
        super(raw, target, originalSlice, parsedAnnot, annotationDocstringOff, source);

        // Location of the predicate relative to the begining of the file
        this.exprLoc = offsetBy(
            rangeToOffsetRange(parsedAnnot.expression.requiredSrc),
            this.parseOff
        );
        this.predicateFileLoc = rangeToLocRange(this.exprLoc[0], this.exprLoc[1], source);
    }

    /**
     * Convert a location relative to the predicate into a file-wide location
     */
    predOffToFileLoc(arg: OffsetRange, source: string): Range {
        const fileOff = offsetBy(arg, this.exprLoc);

        return rangeToLocRange(fileOff[0], fileOff[1], source);
    }
}

export class PPAbleError extends Error {
    readonly range: Range;
    constructor(msg: string, range: Range) {
        super(msg);
        this.range = range;
    }
}

export class AnnotationError extends PPAbleError {
    readonly annotation: string;
    readonly target: AnnotationTarget;

    constructor(msg: string, annotation: string, range: Range, target: AnnotationTarget) {
        super(msg, range);

        this.annotation = annotation;
        this.target = target;
    }
}

export class SyntaxError extends AnnotationError {}
export class UnsupportedByTargetError extends AnnotationError {}

type RawMetaData = {
    target: AnnotationTarget;
    node: StructuredDocumentation;
    text: string;
    loc: OffsetRange;
};

class AnnotationExtractor {
    private makeAnnotationFromMatch(
        match: RegExpExecArray,
        meta: RawMetaData,
        source: string
    ): AnnotationMetaData {
        const slice = meta.text.slice(match.index);
        let parsedAnnot: SAnnotation;

        try {
            parsedAnnot = parseAnnotation(slice);
        } catch (e) {
            if (e instanceof ExprPEGSSyntaxError) {
                // Compute the syntax error offset relative to the start of the file
                const [errStartOff, errLength] = offsetBy(
                    offsetBy([e.location.start.offset, e.location.end.offset], match.index),
                    meta.loc
                );

                const errRange = rangeToLocRange(errStartOff, errLength, source);
                const original = meta.text.slice(
                    match.index,
                    match.index + errStartOff + errLength + 10
                );

                throw new SyntaxError(e.message, original, errRange, meta.target);
            }

            throw e;
        }

        if (parsedAnnot instanceof SProperty) {
            return new PropertyMetaData(
                meta.node,
                meta.target,
                slice,
                parsedAnnot,
                match.index,
                source
            );
        }

        if (parsedAnnot instanceof SUserFunctionDefinition) {
            return new UserFunctionDefinitionMetaData(
                meta.node,
                meta.target,
                slice,
                parsedAnnot,
                match.index,
                source
            );
        }

        throw new Error(`NYI annotation ${parsedAnnot.pp()}`);
    }

    private validateAnnotation(target: AnnotationTarget, annotation: AnnotationMetaData) {
        if (target instanceof ContractDefinition) {
            if (
                annotation.type !== AnnotationType.Invariant &&
                annotation.type !== AnnotationType.Define
            ) {
                throw new UnsupportedByTargetError(
                    `The "${annotation.type}" annotation is not applicable to contracts`,
                    annotation.original,
                    annotation.annotationFileRange,
                    target
                );
            }

            // @todo (dimo) add support for user functions on interfaces/libraries and add tests with that
            if (target.kind === ContractKind.Interface || target.kind === ContractKind.Library) {
                throw new UnsupportedByTargetError(
                    `Unsupported contract annotations on ${target.kind} ${target.name}`,
                    annotation.original,
                    annotation.annotationFileRange,
                    target
                );
            }
        } else if (target instanceof FunctionDefinition) {
            if (annotation.type !== AnnotationType.IfSucceeds) {
                throw new UnsupportedByTargetError(
                    `The "${annotation.type}" annotation is not applicable to functions`,
                    annotation.original,
                    annotation.annotationFileRange,
                    target
                );
            }

            if (target.vScope instanceof SourceUnit) {
                throw new UnsupportedByTargetError(
                    `Instrumenting free functions is not supported`,
                    annotation.original,
                    annotation.annotationFileRange,
                    target
                );
            }
        } else {
            if (
                annotation.type !== AnnotationType.IfUpdated &&
                annotation.type !== AnnotationType.IfAssigned
            ) {
                throw new UnsupportedByTargetError(
                    `The "${annotation.type}" annotation is not applicable to state variables`,
                    annotation.original,
                    annotation.annotationFileRange,
                    target
                );
            }

            if (!(target.vScope instanceof ContractDefinition)) {
                throw new UnsupportedByTargetError(
                    `The "${annotation.type}" annotation is only applicable to state variables`,
                    annotation.original,
                    annotation.annotationFileRange,
                    target
                );
            }
        }
    }

    private findAnnotations(
        raw: StructuredDocumentation,
        target: AnnotationTarget,
        source: string,
        filters: AnnotationFilterOptions
    ): AnnotationMetaData[] {
        const rxType = filters.type === undefined ? undefined : new RegExp(filters.type);
        const rxMsg = filters.message === undefined ? undefined : new RegExp(filters.message);

        const sourceInfo = raw.sourceInfo;

        const meta: RawMetaData = {
            target: target,
            node: raw,
            text: raw.extractSourceFragment(source),
            loc: [sourceInfo.offset, sourceInfo.length]
        };

        const result: AnnotationMetaData[] = [];

        const rx = /\s*(\*|\/\/\/)\s*(if_succeeds|if_updated|if_assigned|invariant|define\s*[a-zA-Z0-9_]*\s*\([^)]*\))/g;

        let match = rx.exec(meta.text);

        while (match !== null) {
            const annotation = this.makeAnnotationFromMatch(match, meta, source);

            if (
                (rxType === undefined || rxType.test(annotation.type)) &&
                (rxMsg === undefined || rxMsg.test(annotation.message))
            ) {
                this.validateAnnotation(target, annotation);

                result.push(annotation);
            }

            rx.lastIndex = match.index + annotation.original.length;

            match = rx.exec(meta.text);
        }

        return result;
    }

    extract(
        node: ContractDefinition | FunctionDefinition | VariableDeclaration,
        sources: Map<string, string>,
        filters: AnnotationFilterOptions
    ): AnnotationMetaData[] {
        const result: AnnotationMetaData[] = [];

        if (node.documentation === undefined) {
            return result;
        }

        const raw = node.documentation;

        if (!(raw instanceof StructuredDocumentation)) {
            throw new Error(`Expected structured documentation not string`);
        }

        const unit = getScopeUnit(node);

        const source = sources.get(unit.absolutePath) as string;
        const annotations = this.findAnnotations(raw, node, source, filters);

        result.push(...annotations);

        return result;
    }
}

export type AnnotationMap = Map<AnnotationTarget, AnnotationMetaData[]>;

/**
 * Gather annotations from `fun` and all functions up the inheritance tree
 * that `fun` overrides.
 */
export function gatherFunctionAnnotations(
    fun: FunctionDefinition,
    annotationMap: AnnotationMap
): AnnotationMetaData[] {
    // Free functions can not be overriden and shouldn't have annotations.
    if (!(fun.vScope instanceof ContractDefinition)) {
        return [];
    }

    let overridee: FunctionDefinition | undefined = fun;
    let scope = overridee.vScope as ContractDefinition;
    const result: AnnotationMetaData[] = annotationMap.get(fun) as AnnotationMetaData[];

    while ((overridee = resolve(scope, overridee, true)) !== undefined) {
        result.unshift(...(annotationMap.get(overridee) as AnnotationMetaData[]));

        scope = overridee.vScope as ContractDefinition;
    }

    return result;
}

/**
 * Find all annotations in the list of `SourceUnit`s `units` and combine them in a
 * map from ASTNode to its annotations. Return the resulting map.
 *
 * @param units - list of `SourceUnits`
 * @param sources - mapping from file-names to their contents. Used during annotation extraction
 * @param filters - any user provided filters for which annotations to consider
 */
export function buildAnnotationMap(
    units: SourceUnit[],
    sources: Map<string, string>,
    filters: AnnotationFilterOptions
): AnnotationMap {
    const res: AnnotationMap = new Map();
    const extractor = new AnnotationExtractor();

    for (const unit of units) {
        // Check no annotations on free functions
        for (const freeFun of unit.vFunctions) {
            const annots = extractor.extract(freeFun, sources, filters);
            if (annots.length !== 0) {
                throw new UnsupportedByTargetError(
                    `The "${annots[0].type}" annotation is not applicable to free functions`,
                    annots[0].original,
                    annots[0].annotationFileRange,
                    freeFun
                );
            }
        }

        // Check no annotations on file-level constants.
        for (const fileLevelConst of unit.vVariables) {
            const annots = extractor.extract(fileLevelConst, sources, filters);
            if (annots.length !== 0) {
                throw new UnsupportedByTargetError(
                    `The "${annots[0].type}" annotation is not applicable to file-level constants`,
                    annots[0].original,
                    annots[0].annotationFileRange,
                    fileLevelConst
                );
            }
        }

        for (const contract of unit.vContracts) {
            res.set(contract, extractor.extract(contract, sources, filters));
            for (const stateVar of contract.vStateVariables) {
                res.set(stateVar, extractor.extract(stateVar, sources, filters));
            }

            for (const method of contract.vFunctions) {
                res.set(method, extractor.extract(method, sources, filters));
            }
        }
    }

    return res;
}
