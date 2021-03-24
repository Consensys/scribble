import {
    ASTNode,
    ASTNodeFactory,
    ContractDefinition,
    EnumDefinition,
    EventDefinition,
    Expression,
    FunctionDefinition,
    ImportDirective,
    ModifierDefinition,
    SourceUnit,
    Statement,
    StructDefinition,
    VariableDeclaration
} from "solc-typed-ast";
import { SUserFunctionDefinition } from "../spec-lang/ast";
import { NameGenerator } from "../util/name_generator";
import { AnnotationMetaData } from "./annotations";
import { CallGraph, FunSet } from "./callgraph";
import { CHA } from "./cha";
import { AnnotationFilterOptions } from "./instrument";

/**
 * Gather all named nodes in the provided source units.
 * @param units list of source units
 */
function getAllNames(units: SourceUnit[]): Set<string> {
    const nameSet: Set<string> = new Set();
    for (const unit of units) {
        for (const child of unit.getChildren()) {
            // Add all named declarations
            if (
                child instanceof ContractDefinition ||
                child instanceof FunctionDefinition ||
                child instanceof ModifierDefinition ||
                child instanceof EventDefinition ||
                child instanceof StructDefinition ||
                child instanceof EnumDefinition ||
                child instanceof VariableDeclaration
            ) {
                nameSet.add(child.name);
            }

            if (child instanceof ImportDirective) {
                // Add unit aliases (import "foo" as foo;)
                if (child.unitAlias !== "") {
                    nameSet.add(child.unitAlias);
                }

                // Add all symbol aliases
                for (const [originalDef, alias] of child.vSymbolAliases) {
                    if (alias !== undefined) {
                        nameSet.add(alias);
                    } else {
                        if (!(originalDef instanceof ImportDirective)) {
                            nameSet.add(originalDef.name);
                        }
                    }
                }
            }
        }
    }
    return nameSet;
}

export class InstrumentationContext {
    public readonly nameGenerator: NameGenerator;
    public readonly structVar: string;
    public readonly checkStateInvsFuncName: string;
    public readonly outOfContractFlagName: string;
    public readonly utilsContractName: string;
    private internalInvariantCheckers: Map<ContractDefinition, string> = new Map();
    public readonly userFunctions: Map<SUserFunctionDefinition, FunctionDefinition> = new Map();

    /**
     * Map from Annotations to the list of statements involved in their evaluation.
     */
    public readonly evaluationStatements: Map<AnnotationMetaData, ASTNode[]> = new Map();
    /**
     * Map from Annotations to the actual `Expression` that corresponds to the
     * annotation being fully checked.
     */
    public readonly instrumentedCheck: Map<AnnotationMetaData, Expression[]> = new Map();
    /**
     * Map from Annotations to the actual asserts and event emissions
     * that are hit if the annotation fails.
     */
    public readonly failureCheck: Map<AnnotationMetaData, Statement[]> = new Map();
    /**
     * List of statements added for general instrumentation, not tied to any
     * particular annotation.
     */
    public readonly generalInstrumentationNodes: ASTNode[] = [];

    /**
     * Bit of a hack - this is set by `generateUtilsContract`. We need an
     * InstrumentationContext already present for `generateUtilsContract` to be able
     * to use `ctx.nameGenerator`.
     */
    public utilsContract!: ContractDefinition;

    public get utilsUnit(): SourceUnit {
        return this.utilsContract.parent as SourceUnit;
    }

    constructor(
        public readonly factory: ASTNodeFactory,
        public readonly units: SourceUnit[],
        public readonly assertionMode: "log" | "mstore",
        public readonly addAssert: boolean,
        public readonly callgraph: CallGraph,
        public readonly cha: CHA<ContractDefinition>,
        public readonly funsToChangeMutability: FunSet,
        public readonly filterOptions: AnnotationFilterOptions,
        public readonly annotations: AnnotationMetaData[],
        public readonly wrapperMap: Map<FunctionDefinition, FunctionDefinition>,
        public readonly files: Map<string, string>,
        public readonly compilerVersion: string,
        public readonly debugEvents: boolean,
        public readonly debugEventDefs: Map<number, EventDefinition>,
        public readonly outputMode: "files" | "flat" | "json"
    ) {
        this.nameGenerator = new NameGenerator(getAllNames(units));
        this.structVar = this.nameGenerator.getFresh("_v", true);
        this.checkStateInvsFuncName = this.nameGenerator.getFresh(
            "__scribble_check_state_invariants",
            true
        );
        this.outOfContractFlagName = this.nameGenerator.getFresh(
            "__scribble_out_of_contract",
            true
        );
        this.utilsContractName = this.nameGenerator.getFresh("__scribble_ReentrancyUtils", true);
    }

    getInternalInvariantCheckerName(contract: ContractDefinition): string {
        if (!this.internalInvariantCheckers.has(contract)) {
            this.internalInvariantCheckers.set(
                contract,
                this.nameGenerator.getFresh(
                    `__scribble_${contract.name}_check_state_invariants_internal`,
                    true
                )
            );
        }

        return this.internalInvariantCheckers.get(contract) as string;
    }

    addGeneralInstrumentation(...nodes: ASTNode[]): void {
        this.generalInstrumentationNodes.push(...nodes);
    }

    addAnnotationInstrumentation(annotation: AnnotationMetaData, ...nodes: ASTNode[]): void {
        const targets = this.evaluationStatements.get(annotation);

        if (targets === undefined) {
            this.evaluationStatements.set(annotation, nodes);
        } else {
            targets.push(...nodes);
        }
    }

    addAnnotationCheck(annotation: AnnotationMetaData, pred: Expression): void {
        const targets = this.instrumentedCheck.get(annotation);

        if (targets === undefined) {
            this.instrumentedCheck.set(annotation, [pred]);
        } else {
            targets.push(pred);
        }
    }

    addAnnotationFailureCheck(annotation: AnnotationMetaData, ...nodes: Statement[]): void {
        const targets = this.failureCheck.get(annotation);

        if (targets === undefined) {
            this.failureCheck.set(annotation, nodes);
        } else {
            targets.push(...nodes);
        }
    }
}
