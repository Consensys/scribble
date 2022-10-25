import expect from "expect";
import {
    ContractDefinition,
    FunctionDefinition,
    FunctionVisibility,
    getABIEncoderVersion,
    InferType,
    SourceUnit,
    StateVariableVisibility,
    VariableDeclaration
} from "solc-typed-ast";
import { ABIEncoderVersion } from "solc-typed-ast/dist/types/abi";
import { searchRecursive } from "../../src";
import { removeProcWd, scrSample, toAst, toAstUsingCache } from "./utils";

function extractExportSymbols(units: SourceUnit[]): Map<string, ContractDefinition> {
    const result = new Map<string, ContractDefinition>();

    for (const unit of units) {
        for (const contract of unit.vContracts) {
            result.set(contract.name, contract);
        }
    }

    return result;
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
): VariableDeclaration | FunctionDefinition | undefined {
    for (const member of members) {
        if (
            (member instanceof VariableDeclaration || member instanceof FunctionDefinition) &&
            member.name === v.name
        ) {
            return member;
        }
    }

    return undefined;
}

function findCorrespondigFn(
    inference: InferType,
    fn: FunctionDefinition,
    members: Array<FunctionDefinition | VariableDeclaration>,
    encVer: ABIEncoderVersion
): FunctionDefinition | undefined {
    for (const member of members) {
        if (
            member instanceof FunctionDefinition &&
            fn.name === member.name &&
            fn.kind === member.kind &&
            inference.signature(fn, encVer) === inference.signature(member, encVer)
        ) {
            return member;
        }
    }

    return undefined;
}

function checkCompatibility(
    inference: InferType,
    a: ContractDefinition,
    b: ContractDefinition,
    encVer: ABIEncoderVersion
) {
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

            if (inference.signature(memberA, encVer) !== inference.signature(memberB, encVer)) {
                throw new Error(
                    `State variable "${a.name}.${
                        memberA.name
                    }" is not compatible instrumented member.\nSample: ${memberA.print()}\nResult: ${memberB.print()}`
                );
            }
        } else if (memberA instanceof FunctionDefinition) {
            const memberB = findCorrespondigFn(inference, memberA, membersB, encVer);

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
    const samples = searchRecursive(samplesDir, (fileName) =>
        fileName.endsWith(".instrumented.sol")
    ).map((fileName) => removeProcWd(fileName).replace(".instrumented.sol", ".sol"));

    it(`Source samples are present in ${samplesDir}`, () => {
        expect(samples.length).toBeGreaterThan(0);
    });

    for (const sample of samples) {
        describe(sample, () => {
            let compilerVersion: string;
            let inAst: SourceUnit[];
            let encVer: ABIEncoderVersion;
            let inference: InferType;

            before(async () => {
                const result = await toAstUsingCache(sample);

                compilerVersion = result.compilerVersion;
                inference = new InferType(compilerVersion);
                inAst = result.units;
                encVer = getABIEncoderVersion(inAst, compilerVersion);
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

                    checkCompatibility(inference, inContract, outContract, encVer);
                }
            };

            it("Instrumented source in 'log' mode has compatible external interface", async () => {
                const result = await toAst(
                    sample + ".log.sol",
                    scrSample(sample, "--debug-events")
                );

                compareSourceUnits(inAst, result.units);
            });

            it("Instrumented source in 'mstore' mode has compatible external interface", async () => {
                const result = await toAst(
                    sample + ".mstore.sol",
                    scrSample(sample, "--user-assert-mode", "mstore")
                );

                compareSourceUnits(inAst, result.units);
            });
        });
    }
});
