import {
    ASTNodeFactory,
    ContractDefinition,
    EventDefinition,
    FunctionDefinition,
    SourceUnit
} from "solc-typed-ast";
import { Annotation } from "./annotations";
import { CallGraph, FunSet } from "./callgraph";
import { CHA } from "./cha";
import { AnnotationFilterOptions } from "./instrument";

export class InstrumentationContext {
    constructor(
        public readonly factory: ASTNodeFactory,
        public readonly units: SourceUnit[],
        public readonly assertionMode: "log" | "mstore",
        public readonly addAssert: boolean,
        public readonly utilsContract: ContractDefinition,
        public readonly callgraph: CallGraph,
        public readonly cha: CHA<ContractDefinition>,
        public readonly funsToChangeMutability: FunSet,
        public readonly filterOptions: AnnotationFilterOptions,
        public readonly annotations: Annotation[],
        public readonly wrapperMap: Map<FunctionDefinition, FunctionDefinition>,
        public readonly files: Map<string, string>,
        public readonly compilerVersion: string,
        public readonly debugEvents: boolean,
        public readonly debugEventDefs: Map<number, EventDefinition>
    ) {}
}
