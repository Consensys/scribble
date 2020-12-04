import {
    ContractDefinition,
    FunctionDefinition,
    resolve,
    SourceUnit,
    StructuredDocumentation,
    VariableDeclaration
} from "@consensys/solc-typed-ast";
import {
    parse as parseAnnotation,
    SyntaxError as AnnotationPEGSSyntaxError
} from "../spec-lang/annotation_parser";
import { Location, Range, SNode } from "../spec-lang/ast";
import { parse as parseExpr, SyntaxError as ExprPEGSSyntaxError } from "../spec-lang/expr_parser";
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

export enum AnnotationType {
    IfSucceeds = "if_succeeds",
    IfAborts = "if_aborts",
    Invariant = "invariant"
}

type OffsetRange = [number, number];

function offsetBy(a: OffsetRange, b: number | OffsetRange): OffsetRange {
    const off = typeof b === "number" ? b : b[0];
    return [a[0] + off, a[1]];
}

let numAnnotations = 0;

export class Annotation {
    /// StructuredDocumentation AST node containing the annotation
    readonly raw: StructuredDocumentation;
    /// Target ast node being annotated. Either FunctionDefintion or ContractDefinition
    readonly target: AnnotationTarget;
    /// Name of target node. We need this to remember the original name, as interposing
    /// destructively changes names
    readonly targetName: string;

    /// Original annotation text
    readonly original: string;
    /// Original annotation predicate text
    readonly predicate: string;
    /// Parsed annotation predicate
    readonly expression: SNode;
    /// Type of this annotation. (if_succeeds|invariant)
    readonly type: AnnotationType;
    /// User label for the annotation. ("" if omitted)
    readonly message: string;
    /// UID of this annotation
    readonly id: number;

    /// Location of the expression relative to the start of the file
    readonly exprLoc: OffsetRange;
    /// Location of the whole annotation relative to the start of the file
    readonly annotationLoc: OffsetRange;
    /// Location of the comment containing the annotation relative to the start of the file
    readonly commentLoc: OffsetRange;

    constructor(
        raw: StructuredDocumentation,
        target: AnnotationTarget,
        original: string,
        predicate: string,
        expression: SNode,
        type: AnnotationType,
        message: string,
        exprLoc: OffsetRange,
        annotationLoc: OffsetRange,
        commentLoc: OffsetRange
    ) {
        this.raw = raw;
        this.target = target;
        // This is a hack. Remember the target name as interposing overwrites it
        this.targetName = target.name;

        this.original = original;
        this.predicate = predicate;
        this.expression = expression;
        this.type = type;
        this.message = message;
        this.id = numAnnotations++;
        this.exprLoc = exprLoc;
        this.annotationLoc = annotationLoc;
        this.commentLoc = commentLoc;
    }

    /// Get the line/column location of the predicate. (relative to the begining of the file)
    predicateFileLoc(source: string): Range {
        return rangeToLocRange(this.exprLoc[0], this.exprLoc[1], source);
    }

    /// Convert a location relative to the predicate into a file-wide location
    predOffToFileLoc(arg: OffsetRange, source: string): Range {
        const fileOff = offsetBy(arg, this.exprLoc);

        return rangeToLocRange(fileOff[0], fileOff[1], source);
    }
}

export class SyntaxError extends Error {
    readonly annotation: string;
    readonly range: Range;

    constructor(msg: string, annotation: string, range: Range) {
        super(msg);

        this.annotation = annotation;
        this.range = range;
    }
}

export class AnnotationExtractor {
    private findAnnotations(
        raw: StructuredDocumentation,
        target: AnnotationTarget,
        source: string
    ): Annotation[] {
        const rawText = raw.extractSourceFragment(source);
        const result: Annotation[] = [];

        const rx = /\s*(\*|\/\/\/)\s*(if_succeeds|if_aborts|invariant)/g;

        let match = rx.exec(rawText);

        const commentSrc = raw.sourceInfo;
        const commentLoc: OffsetRange = [commentSrc.offset, commentSrc.length];

        while (match !== null) {
            let annotationType: AnnotationType;
            let annotationLabel: string;
            let annotationOrig: string;
            let exprOrig: string;
            let exprRange: Range;
            let hasSemi: boolean;
            let annotationLocRelToRegex: Range;

            try {
                [
                    annotationType,
                    annotationLabel,
                    annotationOrig,
                    annotationLocRelToRegex,
                    exprOrig,
                    exprRange,
                    hasSemi
                ] = parseAnnotation(rawText.slice(match.index));
            } catch (e) {
                if (e instanceof AnnotationPEGSSyntaxError) {
                    // Compute the syntax error offset relative to the start of the file
                    const [errStartOff, errLength] = offsetBy(
                        offsetBy([e.location.start.offset, e.location.end.offset], match.index),
                        commentLoc
                    );

                    const errRange = rangeToLocRange(errStartOff, errLength, source);
                    const original = rawText.slice(
                        match.index,
                        match.index + errStartOff + errLength + 10
                    );

                    throw new SyntaxError(e.message, original, errRange);
                }

                throw e;
            }

            const annotationLoc: OffsetRange = offsetBy(
                offsetBy(rangeToOffsetRange(annotationLocRelToRegex), match.index),
                commentLoc
            );

            const exprLoc = offsetBy(
                offsetBy(rangeToOffsetRange(exprRange), match.index),
                commentLoc
            );

            if (!hasSemi) {
                let scope: string;

                if (target instanceof ContractDefinition) {
                    scope = `contract ${target.name}`;
                } else {
                    const prefix =
                        target.vScope instanceof SourceUnit
                            ? ""
                            : (target.vScope as ContractDefinition).name + ".";

                    scope =
                        target instanceof FunctionDefinition
                            ? `function ${prefix}${target.name}`
                            : prefix + target.name;
                }

                const errRange = rangeToLocRange(annotationLoc[0], annotationLoc[1], source);

                throw new SyntaxError(
                    `Line ${errRange.start.line} of ${scope} documentation string looks like an annotation but is not terminated by a semicolon ";" and is ignored: ${annotationOrig}`,
                    annotationOrig,
                    errRange
                );
            }

            try {
                const exprNode = parseExpr(exprOrig);

                result.push(
                    new Annotation(
                        raw,
                        target,
                        annotationOrig,
                        exprOrig,
                        exprNode,
                        annotationType,
                        annotationLabel,
                        exprLoc,
                        annotationLoc,
                        commentLoc
                    )
                );

                rx.lastIndex = match.index + annotationOrig.length;
            } catch (e) {
                if (e instanceof ExprPEGSSyntaxError) {
                    // Compute the syntax error offset relative to the start of the file
                    const [errStartOff, errLength] = offsetBy(
                        [e.location.start.offset, e.location.end.offset],
                        exprLoc
                    );

                    const errRange = rangeToLocRange(errStartOff, errLength, source);
                    const original = exprOrig.slice(errStartOff - 10, errStartOff + errLength + 20);

                    throw new SyntaxError(e.message, original, errRange);
                }

                throw e;
            }

            match = rx.exec(rawText);
        }

        return result;
    }

    private filterAnnotationDefinitions(
        definitions: Annotation[],
        filterOptions: AnnotationFilterOptions
    ): Annotation[] {
        const rxType =
            filterOptions.type === undefined ? undefined : new RegExp(filterOptions.type);

        const rxMsg =
            filterOptions.message === undefined ? undefined : new RegExp(filterOptions.message);

        return definitions.filter((definition) => {
            return (
                (rxType === undefined || rxType.test(definition.type)) &&
                (rxMsg === undefined || rxMsg.test(definition.message))
            );
        });
    }

    extract(
        node: ContractDefinition | FunctionDefinition,
        sources: Map<string, string>,
        filterOptions: AnnotationFilterOptions
    ): Annotation[] {
        const result: Annotation[] = [];

        /**
         * Gather annotations from all overriden functions up the inheritance tree.
         *
         * Note that free functions can not be overriden.
         */
        if (node instanceof FunctionDefinition && node.vScope instanceof ContractDefinition) {
            let overridee: FunctionDefinition | undefined = node;
            let scope = overridee.vScope as ContractDefinition;

            while ((overridee = resolve(scope, overridee, true)) !== undefined) {
                result.push(...this.extract(overridee, sources, filterOptions));

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
        const annotations = this.findAnnotations(raw, node, source);
        const filteredAnnotations = this.filterAnnotationDefinitions(annotations, filterOptions);

        result.push(...filteredAnnotations);

        return result;
    }
}
