import { SType } from "./type";
import { FunctionVisibility, FunctionStateMutability } from "solc-typed-ast";
import { Range } from "..";

export class SFunctionType extends SType {
    public readonly parameters: SType[];
    public readonly returns: SType[];
    public readonly visibility: FunctionVisibility;
    public readonly mutability: FunctionStateMutability;

    constructor(
        parameters: SType[],
        returns: SType[],
        visibility: FunctionVisibility,
        mutability: FunctionStateMutability,
        src?: Range
    ) {
        super(src);
        this.parameters = parameters;
        this.returns = returns;
        this.visibility = visibility;
        this.mutability = mutability;
    }

    pp(): string {
        const returns =
            this.returns.length > 0
                ? ` returns (${this.returns.map((r) => r.pp()).join(",")})`
                : "";
        return `function (${this.parameters.map((p) => p.pp()).join(",")}) ${this.visibility} ${
            this.mutability
        }${returns}`;
    }

    getFields(): any[] {
        return [this.parameters, this.returns, this.visibility, this.mutability];
    }
}
