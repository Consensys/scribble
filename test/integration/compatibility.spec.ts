import {
    ContractDefinition,
    FunctionDefinition,
    FunctionVisibility,
    SourceUnit,
    StateVariableVisibility,
    VariableDeclaration
} from "solc-typed-ast";
import expect from "expect";
import fse from "fs-extra";
import { searchRecursive, toAst } from "./utils";
import { scribble } from "./utils";

function extractExportSymbols(units: SourceUnit[]): Map<string, ContractDefinition> {
    const result = new Map<string, ContractDefinition>();

    for (const unit of units) {
        for (const contract of unit.vContracts) {
            result.set(contract.name, contract);
        }
    }

    return result;
}

function compareVars(a: VariableDeclaration, b: VariableDeclaration, ignoreNames = false): boolean {
    return (
        (a.name === b.name || ignoreNames) &&
        a.typeString === b.typeString &&
        a.stateVariable === b.stateVariable &&
        a.visibility === b.visibility &&
        a.storageLocation === b.storageLocation
    );
}

function extractAccessibleMembers(
    contract: ContractDefinition
): Array<FunctionDefinition | VariableDeclaration> {
    const fns = contract.vFunctions.filter(
        (fn) =>
            fn.visibility === FunctionVisibility.External ||
            fn.visibility === FunctionVisibility.Public
    );

    const vars = contract.vStateVariables.filter(
        (v) => v.visibility === StateVariableVisibility.Public
    );

    return [...fns, ...vars];
}

function findCorrespondigVar(
    v: VariableDeclaration,
    members: Array<FunctionDefinition | VariableDeclaration>
): VariableDeclaration | undefined {
    for (const member of members) {
        if (member instanceof VariableDeclaration && member.name === v.name) {
            return member;
        }
    }

    return undefined;
}

function findCorrespondigFn(
    fn: FunctionDefinition,
    members: Array<FunctionDefinition | VariableDeclaration>
): FunctionDefinition | undefined {
    for (const member of members) {
        if (
            member instanceof FunctionDefinition &&
            fn.name === member.name &&
            fn.kind === member.kind &&
            fn.canonicalSignature === member.canonicalSignature
        ) {
            return member;
        }
    }

    return undefined;
}

function checkCompatibility(a: ContractDefinition, b: ContractDefinition) {
    const membersA = extractAccessibleMembers(a);
    let membersB = extractAccessibleMembers(b);

    // Instrumentation may insert a default constructor.
    if (a.vConstructor === undefined && b.vConstructor !== undefined) {
        membersB = membersB.filter((member) => member !== b.vConstructor);
    }

    if (membersA.length < membersB.length) {
        throw new Error(
            `Contract ${a.name} has more externally accessible members (${membersA.length}) than instrumented version (${membersB.length})`
        );
    }

    for (const memberA of membersA) {
        if (memberA instanceof VariableDeclaration) {
            const memberB = findCorrespondigVar(memberA, membersB);

            if (memberB === undefined) {
                throw new Error(
                    `Unable to find corresponding state variable "${a.name}.${memberA.name}" in instrumented version`
                );
            }

            if (!compareVars(memberA, memberB)) {
                throw new Error(
                    `State variable "${a.name}.${
                        memberA.name
                    }" is not compatible instrumented member.\nSample: ${memberA.print()}\nResult: ${memberB.print()}`
                );
            }
        } else if (memberA instanceof FunctionDefinition) {
            const memberB = findCorrespondigFn(memberA, membersB);

            if (memberB === undefined) {
                throw new Error(
                    `Unable to find corresponding definition "${a.name}.${memberA.name}" (${memberA.kind}) in instrumented version`
                );
            }
        } else {
            throw new Error("Unknown member type");
        }
    }
}

describe("Interface compatibility test", () => {
    const samplesDir = "test/samples/";
    const samples = searchRecursive(samplesDir, /(?<=\.instrumented)\.sol$/).map((fileName) =>
        fileName.replace(".instrumented.sol", ".sol")
    );

    it(`Source samples are present in ${samplesDir}`, () => {
        expect(samples.length).toBeGreaterThan(0);
    });

    for (const fileName of samples) {
        describe(`Sample ${fileName}`, () => {
            let inAst: SourceUnit[];

            before(() => {
                [inAst] = toAst(fileName, fse.readFileSync(fileName, { encoding: "utf8" }));
            });

            const compareSourceUnits = (inAst: SourceUnit[], outAst: SourceUnit[]) => {
                const input = extractExportSymbols(inAst);
                const output = extractExportSymbols(outAst);

                expect(input.size).toBeGreaterThan(0);
                expect(output.size).toBeGreaterThanOrEqual(input.size);

                for (const [name, inContract] of input.entries()) {
                    const outContract = output.get(name);

                    if (outContract === undefined) {
                        throw new Error(`Unable to find contract "${name}" in instrumented AST`);
                    }

                    checkCompatibility(inContract, outContract);
                }
            };

            it("Instrumented source in 'log' mode has compatible external interface", () => {
                const args = [fileName];
                if (!(fileName.includes("if_updated") || fileName.includes("if_assigned"))) {
                    args.push("--debug-events");
                }
                const [outLogAst] = toAst(fileName, scribble(args));
                compareSourceUnits(inAst, outLogAst);
            });

            it("Instrumented source in 'mstore' mode has compatible external interface", () => {
                const [outMStoreAst] = toAst(
                    fileName,
                    scribble(fileName, "--user-assert-mode", "mstore")
                );
                compareSourceUnits(inAst, outMStoreAst);
            });
        });
    }
});
