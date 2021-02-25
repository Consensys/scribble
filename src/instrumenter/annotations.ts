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
import { AnnotationFilterOptions } from "./instrument";

const srcLocation = require("src-location");

function indexToLocation(contents: string, ind: number): Location {
    const t = srcLocation.indexToLocation(contents, ind, true);
    return { offset: ind, line: t.line, column: t.column };
}

function rangeToLocRange(start: number, length: number, contents: string): Range {
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
        original: string,
        parsedAnnot: T,
        annotationDocstringOff: number,
        source: string
    ) {
        this.raw = raw;
        this.target = target;
        // This is a hack. Remember the target name as interposing overwrites it
        this.targetName = target.name;

        this.original = original;
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
    /// Original body text
    readonly bodyText: string;
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
        original: string,
        parsedAnnot: SUserFunctionDefinition,
        annotationDocstringOff: number,
        source: string
    ) {
        super(raw, target, original, parsedAnnot, annotationDocstringOff, source);
        // Original predicate
        this.bodyText = parsedAnnot.body.getSourceFragment(original);
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
    /// Original annotation predicate text
    readonly predicate: string;
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
        original: string,
        parsedAnnot: SProperty,
        annotationDocstringOff: number,
        source: string
    ) {
        super(raw, target, original, parsedAnnot, annotationDocstringOff, source);

        // Original predicate
        this.predicate = parsedAnnot.expression.getSourceFragment(original);
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

export class AnnotationError extends Error {
    readonly annotation: string;
    readonly range: Range;

    constructor(msg: string, annotation: string, range: Range) {
        super(msg);

        this.annotation = annotation;
        this.range = range;
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

export class AnnotationExtractor {
    private makeAnnotationFromMatch(
        match: RegExpExecArray,
        meta: RawMetaData,
        source: string
    ): AnnotationMetaData {
        let annotationOrig: string;
        let parsedAnnot: SAnnotation;

        try {
            const slice = meta.text.slice(match.index);
            parsedAnnot = parseAnnotation(slice);

            annotationOrig = parsedAnnot.getSourceFragment(slice);
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

                throw new SyntaxError(e.message, original, errRange);
            }

            throw e;
        }

        if (parsedAnnot instanceof SProperty) {
            return new PropertyMetaData(
                meta.node,
                meta.target,
                annotationOrig,
                parsedAnnot,
                match.index,
                source
            );
        }

        if (parsedAnnot instanceof SUserFunctionDefinition) {
            return new UserFunctionDefinitionMetaData(
                meta.node,
                meta.target,
                annotationOrig,
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
                    annotation.annotationFileRange
                );
            }

            // @todo (dimo) add support for user functions on interfaces/libraries and add tests with that
            if (target.kind === ContractKind.Interface || target.kind === ContractKind.Library) {
                throw new UnsupportedByTargetError(
                    `Unsupported contract annotations on ${target.kind} ${target.name}`,
                    annotation.original,
                    annotation.annotationFileRange
                );
            }
        } else if (target instanceof FunctionDefinition) {
            if (annotation.type !== AnnotationType.IfSucceeds) {
                throw new UnsupportedByTargetError(
                    `The "${annotation.type}" annotation is not applicable to functions`,
                    annotation.original,
                    annotation.annotationFileRange
                );
            }

            if (target.vScope instanceof SourceUnit) {
                throw new UnsupportedByTargetError(
                    `Instrumenting free functions is not supported`,
                    annotation.original,
                    annotation.annotationFileRange
                );
            }
        } else {
            throw new Error(`NYI Target ${target.constructor.name}#${target.id}`);
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

        const rx = /\s*(\*|\/\/\/)\s*(if_succeeds|invariant|define)/g;

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
        node: ContractDefinition | FunctionDefinition,
        sources: Map<string, string>,
        filters: AnnotationFilterOptions
    ): AnnotationMetaData[] {
        const result: AnnotationMetaData[] = [];

        /**
         * Gather annotations from all overriden functions up the inheritance tree.
         *
         * Note that free functions can not be overriden.
         */
        if (node instanceof FunctionDefinition && node.vScope instanceof ContractDefinition) {
            let overridee: FunctionDefinition | undefined = node;
            let scope = overridee.vScope as ContractDefinition;

            while ((overridee = resolve(scope, overridee, true)) !== undefined) {
                result.push(...this.extract(overridee, sources, filters));

                scope = overridee.vScope as ContractDefinition;
            }
        }

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
