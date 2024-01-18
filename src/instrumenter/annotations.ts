import {
    assert,
    ContractDefinition,
    ContractKind,
    FunctionDefinition,
    InferType,
    resolve,
    resolveAny,
    SourceUnit,
    Statement,
    StatementWithChildren,
    StructuredDocumentation,
    bytesToString,
    TryCatchClause,
    VariableDeclaration,
    strUTF16IndexToUTF8Offset
} from "solc-typed-ast";
import { MacroDefinition, parseMacroMethodSignature } from "../macros";
import {
    AnnotationType,
    SAnnotation,
    SId,
    SLetAnnotation,
    SMacro,
    SNode,
    SProperty,
    STryAnnotation,
    SUserConstantDefinition,
    SUserFunctionDefinition
} from "../spec-lang/ast";
import { PeggySyntaxError as ExprPEGSSyntaxError, parseAnnotation } from "../spec-lang/expr_parser";
import { PPAbleError } from "../util/errors";
import { adjustRange, makeIdxToOffMap, makeRange, Range, rangeToLocRange } from "../util";
import { getOr, getScopeUnit, zip } from "../util/misc";
import { SourceFile, SourceMap } from "../util/sources";

const srcloc = require("src-location");

export type AnnotationFilterOptions = {
    type?: string;
    message?: string;
};

export type AnnotationExtractionContext = {
    filterOptions: AnnotationFilterOptions;
    inference: InferType;
    macros: Map<string, MacroDefinition>;
};

export type AnnotationTarget =
    | ContractDefinition
    | FunctionDefinition
    | VariableDeclaration
    | Statement
    | StatementWithChildren<any>;

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
    /// In flat mode we destructively modify SourceUnits and move definitions to a new unit.
    /// Remember the original source file name for the annotation for use in json_output
    readonly originalSourceFile: SourceFile;

    constructor(
        raw: StructuredDocumentation,
        target: AnnotationTarget,
        parsedAnnot: T,
        source: SourceFile,
        definitionSource?: SourceFile
    ) {
        this.raw = raw;
        this.target = target;
        // This is a hack. Remember the target name as interposing overwrites it
        this.targetName =
            target instanceof Statement || target instanceof StatementWithChildren
                ? ""
                : target.name;

        this.original = parsedAnnot.getSourceFragment(
            definitionSource ? definitionSource.rawContents : source.rawContents
        );

        this.id = numAnnotations++;
        this.parsedAnnot = parsedAnnot;
        /// Location of the annotation relative to the start of the file
        this.originalSourceFile = source;
    }

    get originalFileName(): string {
        return this.originalSourceFile.fileName;
    }

    get annotationFileRange(): Range {
        return this.parsedAnnot.requiredRange;
    }
}

export type AnnotationMap = Map<AnnotationTarget, AnnotationMetaData[]>;

/**
 * Metadata specific to a user constant definition.
 */
export class UserConstantDefinitionMetaData extends AnnotationMetaData<SUserConstantDefinition> {}

/**
 * Metadata specific to a user function definition.
 */
export class UserFunctionDefinitionMetaData extends AnnotationMetaData<SUserFunctionDefinition> {}

/**
 * Metadata specific to a property annotation (invariant, if_succeeds)
 */
export class PropertyMetaData extends AnnotationMetaData<SProperty> {}

/**
 * Metadata specific to a ghost var definition (invariant, if_succeeds)
 */
export class LetAnnotationMetaData extends AnnotationMetaData<SLetAnnotation> {}

/**
 * Metadata specific to external software hints (try)
 */
export class TryAnnotationMetaData extends AnnotationMetaData<STryAnnotation> {}

export class MacroMetaData extends AnnotationMetaData<SMacro> {
    readonly macroDefinition: MacroDefinition;

    get definitionFile(): SourceFile {
        return this.macroDefinition.source;
    }

    constructor(
        raw: StructuredDocumentation,
        target: AnnotationTarget,
        parsedAnnot: SMacro,
        source: SourceFile,
        macroDefinition: MacroDefinition
    ) {
        super(raw, target, parsedAnnot, source);

        this.macroDefinition = macroDefinition;
    }

    /**
     * Computes a mapping where "keys" are formal variable names from macro definition
     * and "values" are actual names from macro annotation on contract.
     */
    getAliasingMap(): Map<string, string> {
        const formal = Array.from(this.macroDefinition.variables.keys());
        const actual = this.parsedAnnot.parameters.map((node) => node.name);
        const pairs = zip(
            formal,
            actual,
            "Macro annotation arguments count {0} mismatches macro definition variables count {1}",
            actual.length,
            formal.length
        );

        return new Map(pairs);
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
    docFileOffset: number;
};

function makeAnnotationFromMatch(
    match: RegExpExecArray,
    meta: RawMetaData,
    source: SourceFile,
    ctx: AnnotationExtractionContext
): AnnotationMetaData {
    let matchIdx = match.index;
    while (meta.text[matchIdx].match(/[\n\r]/)) matchIdx++;

    const matchUTF8Offset = strUTF16IndexToUTF8Offset(meta.text, matchIdx);
    const slice = meta.text.slice(matchIdx);

    let annotation: SAnnotation;

    try {
        annotation = parseAnnotation(
            slice,
            meta.target,
            ctx.inference,
            source,
            meta.docFileOffset + matchUTF8Offset
        );
    } catch (e) {
        if (e instanceof ExprPEGSSyntaxError) {
            // Compute the syntax error offset relative to the start of the file
            const errStartOff =
                meta.docFileOffset +
                matchUTF8Offset +
                strUTF16IndexToUTF8Offset(slice, e.location.start.offset);

            const errLength = e.location.end.offset - e.location.start.offset;

            const errRange = rangeToLocRange(errStartOff, errLength, source);
            const original = meta.text.slice(matchIdx, matchIdx + errStartOff + errLength + 10);

            throw new SyntaxError(e.message, original, errRange, meta.target);
        }

        throw e;
    }

    if (annotation instanceof SProperty) {
        return new PropertyMetaData(meta.node, meta.target, annotation, source);
    }

    if (annotation instanceof SUserConstantDefinition) {
        return new UserConstantDefinitionMetaData(meta.node, meta.target, annotation, source);
    }

    if (annotation instanceof SUserFunctionDefinition) {
        return new UserFunctionDefinitionMetaData(meta.node, meta.target, annotation, source);
    }

    if (annotation instanceof SMacro) {
        const macroDef = ctx.macros.get(annotation.name.pp());

        if (macroDef) {
            return new MacroMetaData(meta.node, meta.target, annotation, source, macroDef);
        }

        throw new Error(`Unknown macro ${annotation.name.pp()}`);
    }

    if (annotation instanceof SLetAnnotation) {
        return new LetAnnotationMetaData(meta.node, meta.target, annotation, source);
    }

    if (annotation instanceof STryAnnotation) {
        return new TryAnnotationMetaData(meta.node, meta.target, annotation, source);
    }

    throw new Error(`Unknown annotation ${annotation.pp()}`);
}

/**
 * Checks the validity of an annotation
 * @param annotation The annotation to be validated
 * @param target Target block(contract/function) of the annotation
 */
function validateAnnotation(target: AnnotationTarget, annotation: AnnotationMetaData) {
    if (target instanceof ContractDefinition) {
        const contractApplicableTypes = [
            AnnotationType.Invariant,
            AnnotationType.Define,
            AnnotationType.Const,
            AnnotationType.IfSucceeds,
            AnnotationType.Try,
            AnnotationType.Require,
            AnnotationType.Macro
        ];

        if (!contractApplicableTypes.includes(annotation.type)) {
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
        if (
            annotation.type !== AnnotationType.IfSucceeds &&
            annotation.type !== AnnotationType.Try &&
            annotation.type !== AnnotationType.Require
        ) {
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
    } else if (target instanceof Statement || target instanceof StatementWithChildren) {
        if (
            annotation.type !== AnnotationType.Assert &&
            annotation.type !== AnnotationType.Try &&
            annotation.type !== AnnotationType.Require &&
            annotation.type !== AnnotationType.IfSucceeds &&
            annotation.type !== AnnotationType.LetAnnotation
        ) {
            throw new UnsupportedByTargetError(
                `The "${annotation.type}" annotation is not applicable inside functions`,
                annotation.original,
                annotation.annotationFileRange,
                target
            );
        }

        if (target instanceof TryCatchClause) {
            throw new UnsupportedByTargetError(
                `The "${annotation.type}" annotation is not applicable to try-catch clauses`,
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

function findAnnotations(
    raw: StructuredDocumentation,
    target: AnnotationTarget,
    source: SourceFile,
    ctx: AnnotationExtractionContext
): AnnotationMetaData[] {
    const rxType =
        ctx.filterOptions.type === undefined ? undefined : new RegExp(ctx.filterOptions.type);

    const rxMsg =
        ctx.filterOptions.message === undefined ? undefined : new RegExp(ctx.filterOptions.message);

    const sourceInfo = raw.sourceInfo;

    const meta: RawMetaData = {
        target: target,
        node: raw,
        text: bytesToString(raw.extractSourceFragment(source.rawContents)),
        docFileOffset: sourceInfo.offset
    };

    const result: AnnotationMetaData[] = [];

    const rx =
        /(@custom:scribble)?\s*#(if_succeeds|if_updated|if_assigned|invariant|assert|try|require|macro|define|const|let)/g;

    let match = rx.exec(meta.text);

    while (match !== null) {
        const annotation = makeAnnotationFromMatch(match, meta, source, ctx);

        if (
            (rxType === undefined || rxType.test(annotation.type)) &&
            (rxMsg === undefined || rxMsg.test(annotation.message))
        ) {
            validateAnnotation(target, annotation);

            result.push(annotation);
        }

        rx.lastIndex = match.index + annotation.original.length;

        match = rx.exec(meta.text);
    }

    return result;
}

export function extractAnnotations(
    target: AnnotationTarget,
    sources: SourceMap,
    ctx: AnnotationExtractionContext
): AnnotationMetaData[] {
    const result: AnnotationMetaData[] = [];

    if (target.documentation === undefined) {
        return result;
    }

    const raw = target.documentation;

    if (!(raw instanceof StructuredDocumentation)) {
        throw new Error(`Expected structured documentation not string`);
    }

    const unit = getScopeUnit(target);

    const source = sources.get(unit.absolutePath) as SourceFile;
    const annotations = findAnnotations(raw, target, source, ctx);

    result.push(...annotations);

    return result;
}

/**
 * Gather annotations from `fun` and all functions up the inheritance tree
 * that `fun` overrides.
 */
export function gatherFunctionAnnotations(
    inference: InferType,
    fun: FunctionDefinition,
    annotationMap: AnnotationMap
): AnnotationMetaData[] {
    // Free functions can not be overriden and shouldn't have annotations.
    if (!(fun.vScope instanceof ContractDefinition)) {
        return [];
    }

    let overridee: FunctionDefinition | undefined = fun;
    let scope = overridee.vScope as ContractDefinition;

    // We may have functions missing in annotationMap as map interposing adds new functions
    const result: AnnotationMetaData[] = getOr(annotationMap, fun, []);

    while ((overridee = resolve(scope, overridee, inference, true)) !== undefined) {
        result.unshift(...(annotationMap.get(overridee) as AnnotationMetaData[]));

        scope = overridee.vScope as ContractDefinition;
    }

    return result;
}

/**
 * Gather annotations from `contract` and all it's parent contracts
 */
export function gatherContractAnnotations(
    contract: ContractDefinition,
    annotationMap: AnnotationMap
): AnnotationMetaData[] {
    const result: AnnotationMetaData[] = [];

    for (const base of contract.vLinearizedBaseContracts) {
        result.unshift(...(annotationMap.get(base) as AnnotationMetaData[]));
    }

    return result;
}

export class MacroError extends AnnotationError {}

/**
 * Given a parsed property P, from a macro definition, and the scope in which that macro definition is
 * expanded, find the actual AnnotationTarget of the property P.
 */
function getMacroPropertyTarget(
    scope: AnnotationTarget,
    name: string,
    args: string[],
    meta: MacroMetaData,
    ctx: AnnotationExtractionContext
): AnnotationTarget {
    if (name === "<contract>") {
        assert(
            scope instanceof ContractDefinition,
            `Macro annotation ${meta.parsedAnnot.name} added on non-contract node ${meta.targetName}`
        );
        return scope;
    }

    let targets = [...resolveAny(name, scope, ctx.inference, true)];

    if (targets.length > 1) {
        targets = targets.filter((target) => {
            // TODO: Add support for public getters
            return (
                target instanceof FunctionDefinition &&
                target.vParameters.vParameters.length == args.length
            );
        });
    }

    if (targets.length === 0) {
        throw new MacroError(
            `No target ${name} found in contract ${(scope as ContractDefinition).name} for ${
                meta.original
            }`,
            meta.original,
            meta.parsedAnnot.src as Range,
            meta.target
        );
    }

    if (targets.length > 1) {
        throw new MacroError(
            `Multiple possible targets ${name} found in contract ${
                (scope as ContractDefinition).name
            } for ${meta.original}`,
            meta.original,
            meta.parsedAnnot.src as Range,
            meta.target
        );
    }

    return targets[0];
}

/**
 * Detects macro annotations, produces annotations that are defined by macro
 * and injects them target nodes. Macro annotations are removed afterwards.
 */
function processMacroAnnotations(
    annotationMap: AnnotationMap,
    ctx: AnnotationExtractionContext
): void {
    const injections: AnnotationMap = new Map();

    for (const [scope, metas] of annotationMap) {
        for (let m = 0; m < metas.length; m++) {
            const meta = metas[m];

            if (!(meta instanceof MacroMetaData)) {
                continue;
            }

            const globalAliases = meta.getAliasingMap();

            for (const [signature, properties] of meta.macroDefinition.properties) {
                let name: string;
                let args: string[];

                if (signature.includes("(")) {
                    /**
                     * Signature with method
                     */
                    [name, args] = parseMacroMethodSignature(signature);
                } else {
                    /**
                     * Signature with variable
                     */
                    name = getOr(globalAliases, signature, signature);
                    args = [];
                }

                const localAliases = new Map(globalAliases);

                const target: AnnotationTarget = getMacroPropertyTarget(
                    scope,
                    name,
                    args,
                    meta,
                    ctx
                );

                if (target instanceof FunctionDefinition && args.length > 0) {
                    const params = target.vParameters.vParameters;
                    const pairs = zip(
                        args,
                        params,
                        `{0}: arguments count {1} in macro definition mismatches method arguments count {2}`,
                        signature,
                        args.length,
                        params.length
                    );

                    for (const [formalParam, actualParam] of pairs) {
                        if (formalParam !== "") {
                            /**
                             * Note that it is allowed for global aliases to be SHADOWED by local aliases.
                             * Other solution would require to throw an error in case of name clashing, i.e.:
                             *
                             * ```
                             * assert(
                             *     !localAliases.has(formalParam),
                             *     "{0}: shadowing of globally defined alias {1}",
                             *     signature,
                             *     formalParam
                             * );
                             * ```
                             */
                            localAliases.set(formalParam, actualParam.name);
                        }
                    }
                }

                for (const { expression, message, offset } of properties) {
                    let annotation: SAnnotation;

                    try {
                        annotation = parseAnnotation(
                            expression,
                            target,
                            ctx.inference,
                            meta.definitionFile,
                            offset
                        );
                    } catch (e) {
                        if (e instanceof ExprPEGSSyntaxError) {
                            const { line, column } = srcloc.indexToLocation(
                                meta.definitionFile.contents,
                                offset
                            );

                            const locOpts = {
                                file: meta.definitionFile,
                                baseOff: offset,
                                baseLine: line - 1,
                                baseCol: column,
                                idxToOffMap: makeIdxToOffMap(expression)
                            };
                            const range = makeRange(e.location);
                            adjustRange(range, locOpts);

                            throw new SyntaxError(e.message, expression, range, target);
                        }

                        throw e;
                    }

                    assert(
                        annotation instanceof SProperty,
                        "Only properties are allowed to be defined in macros. Unsupported annotation: {0}",
                        expression
                    );

                    /**
                     * Callback to
                     *
                     * 1) Rename all ids in the macro definition with their
                     *    corresponding values in the instantiation context.
                     *    Renaming can be due to variable arguments for the macro,
                     *    or differing function parameter names
                     *
                     * 2) Update the location of each node to reflect both the
                     *    original macro location as well as the macro
                     *    instantiation location
                     */
                    const walker = (node: SNode) => {
                        if (node instanceof SId) {
                            const actualName = localAliases.get(node.name);

                            if (actualName !== undefined) {
                                node.name = actualName;
                            }
                        }

                        node.src = [node.src as Range, meta.parsedAnnot.src as Range];
                    };

                    /**
                     * Replace macro aliases with supplied variable names in macro annotation
                     */
                    annotation.walk(walker);

                    /**
                     * Use property message in macro definition as a label for injected annotation
                     */
                    annotation.label = message;

                    const dummyDoc = new StructuredDocumentation(
                        0,
                        "0:0:0",
                        "StructuredDocumentation",
                        "#" + annotation.pp()
                    );

                    const metaToInject = new PropertyMetaData(
                        dummyDoc,
                        target,
                        annotation,
                        meta.originalSourceFile,
                        meta.definitionFile
                    );

                    validateAnnotation(target, metaToInject);

                    const metasToInject = injections.get(target);

                    if (metasToInject === undefined) {
                        injections.set(target, [metaToInject]);
                    } else {
                        metasToInject.push(metaToInject);
                    }
                }
            }

            /**
             * Remove macro annotation as it will not pass type-checking.
             * It is now represented by other annotations in `injections`,
             * so there is no further use for macro annotation itself.
             */
            metas.splice(m, 1);
        }
    }

    /**
     * Merge injected annotations with original annotations.
     */
    for (const [target, metasToInject] of injections) {
        const metas = annotationMap.get(target);

        if (metas === undefined) {
            annotationMap.set(target, metasToInject);
        } else {
            metas.push(...metasToInject);
        }
    }
}

/**
 * Find all annotations in the list of `SourceUnit`s `units` and combine them in a
 * map from ASTNode to its annotations. Return the resulting map.
 *
 * @param units - List of `SourceUnit`s.
 * @param sources - Mapping from file names to their contents. Used during annotation extraction.
 * @param ctx - Annotation context to consider while processing annotations.
 */
export function buildAnnotationMap(
    units: SourceUnit[],
    sources: SourceMap,
    ctx: AnnotationExtractionContext
): AnnotationMap {
    const res: AnnotationMap = new Map();

    for (const unit of units) {
        // Check no annotations on free functions
        for (const freeFun of unit.vFunctions) {
            const annots = extractAnnotations(freeFun, sources, ctx);

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
            const annots = extractAnnotations(fileLevelConst, sources, ctx);

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
            res.set(contract, extractAnnotations(contract, sources, ctx));

            for (const stateVar of contract.vStateVariables) {
                res.set(stateVar, extractAnnotations(stateVar, sources, ctx));
            }

            for (const method of contract.vFunctions) {
                res.set(method, extractAnnotations(method, sources, ctx));
            }
        }

        // Finally check for any assertions
        for (const stmt of unit.getChildrenBySelector(
            (nd) => nd instanceof Statement || nd instanceof StatementWithChildren
        )) {
            res.set(
                stmt as Statement | StatementWithChildren<any>,
                extractAnnotations(stmt, sources, ctx)
            );
        }
    }

    processMacroAnnotations(res, ctx);

    return res;
}
