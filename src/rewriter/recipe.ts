import {
    ASTNode,
    ASTNodeFactory,
    Block,
    ContractDefinition,
    DataLocation,
    EventDefinition,
    Expression,
    FunctionCall,
    FunctionDefinition,
    FunctionKind,
    FunctionStateMutability,
    FunctionVisibility,
    ModifierDefinition,
    ModifierInvocation,
    OverrideSpecifier,
    SourceUnit,
    Statement,
    StateVariableVisibility,
    StructDefinition,
    StructuredDocumentation,
    VariableDeclaration
} from "solc-typed-ast";
import "path";
import { basename } from "path";
import { assert } from "../util";

type MaybeLazy<T> = T | (() => T);

function evalLazy<T>(v: MaybeLazy<T>): T {
    return v instanceof Function ? v() : v;
}

export type Recipe = RecipeStep[];

export abstract class RecipeStep {
    constructor(public readonly factory: ASTNodeFactory) {}

    abstract apply(): void;
    abstract pp(): string;
}

export abstract class ChangeNodePropertyStep<
    T extends ASTNode,
    K extends keyof T
> extends RecipeStep {
    constructor(
        factory: ASTNodeFactory,
        public readonly node: T,
        public readonly property: K,
        public readonly newVal: T[K]
    ) {
        super(factory);
    }

    apply(): void {
        this.node[this.property] = this.newVal;
    }

    pp(): string {
        return `Change ${this.property} of ${this.node.print()} from ${
            this.node[this.property]
        } to ${this.node[this.property]}`;
    }
}

export type NamedNode =
    | FunctionDefinition
    | VariableDeclaration
    | ContractDefinition
    | EventDefinition
    | ModifierDefinition;

export class Rename extends ChangeNodePropertyStep<NamedNode, "name"> {
    constructor(
        factory: ASTNodeFactory,
        public readonly node: NamedNode,
        public readonly newName: string
    ) {
        super(factory, node, "name", newName);
    }
}

export type VisibleNode = FunctionDefinition | VariableDeclaration | ModifierDefinition;

export class ChangeVisibility extends ChangeNodePropertyStep<VisibleNode, "visibility"> {
    constructor(
        factory: ASTNodeFactory,
        node: VisibleNode,
        public readonly newVisibility: FunctionVisibility | StateVariableVisibility
    ) {
        super(factory, node, "visibility", newVisibility);
    }
}

export class ChangeFunctionMutability extends ChangeNodePropertyStep<
    FunctionDefinition,
    "stateMutability"
> {
    constructor(
        factory: ASTNodeFactory,
        node: FunctionDefinition,
        public readonly newMutability: FunctionStateMutability
    ) {
        super(factory, node, "stateMutability", newMutability);
    }
}

export class ChangeFunctionModifiers extends ChangeNodePropertyStep<
    FunctionDefinition,
    "vModifiers"
> {
    constructor(
        factory: ASTNodeFactory,
        node: FunctionDefinition,
        public readonly newModifiers: ModifierInvocation[]
    ) {
        super(factory, node, "vModifiers", newModifiers);
    }
}

export class ChangeFunctionDocumentation extends ChangeNodePropertyStep<
    FunctionDefinition,
    "documentation"
> {
    constructor(
        factory: ASTNodeFactory,
        node: FunctionDefinition,
        public readonly newDoc: StructuredDocumentation | undefined
    ) {
        super(factory, node, "documentation", newDoc);
    }
}

export class ChangeFunctionOverrides extends ChangeNodePropertyStep<
    FunctionDefinition,
    "vOverrideSpecifier"
> {
    constructor(
        factory: ASTNodeFactory,
        node: FunctionDefinition,
        public readonly newOverrideSpec: OverrideSpecifier | undefined
    ) {
        super(factory, node, "vOverrideSpecifier", newOverrideSpec);
    }
}

export class ChangeFunctionVirtual extends ChangeNodePropertyStep<FunctionDefinition, "virtual"> {
    constructor(
        factory: ASTNodeFactory,
        node: FunctionDefinition,
        public readonly newVirtual: boolean
    ) {
        super(factory, node, "virtual", newVirtual);
    }
}

export class ChangeFunctionKind extends ChangeNodePropertyStep<FunctionDefinition, "kind"> {
    constructor(
        factory: ASTNodeFactory,
        node: FunctionDefinition,
        public readonly newKind: FunctionKind
    ) {
        super(factory, node, "kind", newKind);
    }
}

export class ChangeArgumentLocation extends ChangeNodePropertyStep<
    VariableDeclaration,
    "storageLocation"
> {
    constructor(
        factory: ASTNodeFactory,
        node: VariableDeclaration,
        public readonly newLocation: DataLocation
    ) {
        super(factory, node, "storageLocation", newLocation);
    }
}

export class InsertFunctionBefore extends RecipeStep {
    constructor(
        factory: ASTNodeFactory,
        public readonly beforeFun: FunctionDefinition,
        public readonly newFun: FunctionDefinition
    ) {
        super(factory);
    }

    apply(): void {
        const scope = this.beforeFun.vScope;

        scope.insertBefore(this.newFun, this.beforeFun);

        this.newFun.vScope = scope;
    }

    pp(): string {
        const scope = this.beforeFun.vScope;
        const loc = scope instanceof ContractDefinition ? "in " + scope.name : "on unit level";

        return `Insert the function ${this.newFun.name} before ${this.beforeFun.name} ${loc}`;
    }
}

export class InsertFunction extends RecipeStep {
    constructor(
        factory: ASTNodeFactory,
        public readonly contract: ContractDefinition,
        public readonly newFun: FunctionDefinition
    ) {
        super(factory);
    }

    apply(): void {
        this.contract.appendChild(this.newFun);

        this.newFun.vScope = this.contract;
    }

    pp(): string {
        return `Insert the function ${this.newFun.name} in ${this.contract.name}`;
    }
}

export class AddConstructor extends InsertFunction {
    apply(): void {
        assert(
            this.contract.vConstructor === undefined,
            `Trying to override constructor for ${this.contract.name}`
        );

        super.apply();

        this.newFun.isConstructor = true;
        this.newFun.kind = FunctionKind.Constructor;
    }
}

export class RenameReturn extends RecipeStep {
    constructor(
        factory: ASTNodeFactory,
        public readonly fun: FunctionDefinition,
        public readonly returnIdx: number,
        public readonly newName: string
    ) {
        super(factory);
    }

    apply(): void {
        this.fun.vReturnParameters.vParameters[this.returnIdx].name = this.newName;
    }

    pp(): string {
        return `Rename the ${this.returnIdx}-th return of function ${this.fun.name} to ${this.newName}`;
    }
}

export class InsertStatement extends RecipeStep {
    constructor(
        factory: ASTNodeFactory,
        public readonly newStatement: MaybeLazy<Statement>,
        public readonly where: "start" | "end" | "before" | "after",
        public readonly block: Block,
        public readonly otherStmt?: MaybeLazy<Statement>
    ) {
        super(factory);
    }

    apply(): void {
        const newStatement = evalLazy(this.newStatement);

        if (this.where === "start") {
            if (this.block.firstChild) {
                this.block.insertBefore(newStatement, this.block.firstChild);
            } else {
                this.block.appendChild(newStatement);
            }
        } else if (this.where === "end") {
            this.block.appendChild(newStatement);
        } else {
            const otherStmt = evalLazy(this.otherStmt);

            if (otherStmt === undefined) {
                throw Error(`Not specified other statement for location ${this.where}`);
            }

            if (this.where === "before") {
                this.block.insertBefore(newStatement, otherStmt);
            } else {
                this.block.insertAfter(newStatement, otherStmt);
            }
        }
    }

    pp(): string {
        return `Insert the statement ${
            this.newStatement instanceof Statement
                ? this.newStatement.print()
                : this.newStatement().print()
        } at the start of block ${this.block.print()}`;
    }
}

export class InsertStructDef extends RecipeStep {
    constructor(
        factory: ASTNodeFactory,
        public readonly newStructDef: MaybeLazy<StructDefinition>,
        public readonly contract: ContractDefinition
    ) {
        super(factory);
    }

    apply(): void {
        const newStructDef = evalLazy(this.newStructDef);

        this.contract.appendChild(newStructDef);

        newStructDef.vScope = this.contract;
    }

    pp(): string {
        return `Add struct def ${evalLazy(this.newStructDef).name} to ${this.contract.name}`;
    }
}

export function cook(recipe: Recipe): void {
    for (const step of recipe) {
        step.apply();
    }
}

export class InsertEvent extends RecipeStep {
    constructor(
        factory: ASTNodeFactory,
        public readonly contract: ContractDefinition,
        public readonly newEvent: EventDefinition
    ) {
        super(factory);
    }

    apply(): void {
        this.contract.appendChild(this.newEvent);
    }

    pp(): string {
        return `Insert the event ${this.newEvent.name} in ${this.contract.name}`;
    }
}

export class AddBaseContract extends RecipeStep {
    constructor(
        factory: ASTNodeFactory,
        public readonly contract: ContractDefinition,
        public readonly newBase: ContractDefinition,
        public readonly where: "start" | "end"
    ) {
        super(factory);
    }

    apply(): void {
        const inhSpec = this.factory.makeInheritanceSpecifier(
            this.factory.makeUserDefinedTypeName("<missing>", this.newBase.name, this.newBase.id),
            []
        );

        if (this.where === "start") {
            this.contract.linearizedBaseContracts.unshift(this.newBase.id);

            const specs = this.contract.vInheritanceSpecifiers;

            if (specs.length !== 0) {
                this.contract.insertBefore(inhSpec, specs[0]);
            } else {
                this.contract.appendChild(inhSpec);
            }
        } else {
            this.contract.linearizedBaseContracts.push(this.newBase.id);

            this.contract.appendChild(inhSpec);
        }
    }

    pp(): string {
        return `Add ${this.newBase.name} as a base for ${this.contract.name}`;
    }
}

export class AddImport extends RecipeStep {
    constructor(
        factory: ASTNodeFactory,
        public readonly unit: SourceUnit,
        public readonly importedUnit: SourceUnit
    ) {
        super(factory);
    }

    apply(): void {
        const absolutePath = this.importedUnit.absolutePath;
        const importDirective = this.factory.makeImportDirective(
            basename(absolutePath),
            absolutePath,
            "",
            [],
            this.unit.id,
            this.importedUnit.id
        );

        this.unit.appendChild(importDirective);
    }

    pp(): string {
        return `Add import ${this.importedUnit.absolutePath} to ${this.unit.absolutePath}`;
    }
}

export class ReplaceCallee extends RecipeStep {
    constructor(
        factory: ASTNodeFactory,
        public readonly oldCallee: Expression,
        public readonly newCallee: Expression
    ) {
        super(factory);
    }

    apply(): void {
        const parent = this.oldCallee.parent;

        assert(parent instanceof FunctionCall && parent.vExpression === this.oldCallee, ``);
        assert(this.newCallee instanceof Expression, ``);

        parent.vExpression = this.newCallee;
    }

    pp(): string {
        return `Replace ${this.oldCallee.print()} with ${this.newCallee.print()}`;
    }
}

export class InsertArgument extends RecipeStep {
    constructor(
        factory: ASTNodeFactory,
        public readonly newArg: Expression,
        public readonly where: "start" | "end" | "before" | "after",
        public readonly under: FunctionCall,
        public readonly otherNode?: Expression
    ) {
        super(factory);
    }

    apply(): void {
        if (this.where === "start") {
            this.under.vArguments.unshift(this.newArg);
        } else if (this.where === "end") {
            this.under.vArguments.push(this.newArg);
        } else {
            assert(this.otherNode !== undefined, ``);

            const argIdx = this.under.vArguments.indexOf(this.otherNode);

            if (this.where === "before") {
                this.under.vArguments.splice(argIdx, 0, this.newArg);
            } else {
                this.under.vArguments.splice(argIdx + 1, 0, this.newArg);
            }
        }

        this.newArg.parent = this.under;
    }

    pp(): string {
        const newNodeStr = evalLazy(this.newArg).print();
        const parentStr = this.under.print();

        let loc: string;

        if (this.where === "start") {
            loc = `at the start of ${parentStr}`;
        } else if (this.where === "end") {
            loc = `at the end of ${parentStr}`;
        } else {
            const otherNode = evalLazy(this.otherNode)?.print();

            if (this.where === "before") {
                loc = `before ${otherNode} under ${parentStr}`;
            } else {
                loc = `after ${otherNode} under ${parentStr}`;
            }
        }

        return `Insert ${newNodeStr}  ${loc}`;
    }
}
