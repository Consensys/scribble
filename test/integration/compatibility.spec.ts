import expect from "expect";
import {
    ContractDefinition,
    FunctionDefinition,
    FunctionVisibility,
    getABIEncoderVersion,
    SourceUnit,
    StateVariableVisibility,
    VariableDeclaration
} from "solc-typed-ast";
import { ABIEncoderVersion } from "solc-typed-ast/dist/types/abi";
import { removeProcWd, scribble, searchRecursive, toAst, toAstUsingCache } from "./utils";

function extractExportSymbols(units: SourceUnit[]): Map<string, ContractDefinition> {
    const result = new Map<string, ContractDefinition>();

    for (const unit of units) {
        for (const contract of unit.vContracts) {
            result.set(contract.name, contract);
        }
    }

    return result;
}

function compareVars(
    a: VariableDeclaration,
    b: VariableDeclaration | FunctionDefinition,
    encoderVer: ABIEncoderVersion
): boolean {
    // In some cases we may re-write a public state var into an internal state var with a getter function
    const bSig =
        b instanceof VariableDeclaration
            ? b.getterCanonicalSignature(encoderVer)
            : b.canonicalSignature(encoderVer);
    return a.getterCanonicalSignature(encoderVer) === bSig;
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
    fn: FunctionDefinition,
    members: Array<FunctionDefinition | VariableDeclaration>,
    encoderVer: ABIEncoderVersion
): FunctionDefinition | undefined {
    const fnCanonSig = fn.canonicalSignature(encoderVer);

    for (const member of members) {
        if (
            member instanceof FunctionDefinition &&
            fn.name === member.name &&
            fn.kind === member.kind &&
            fnCanonSig === member.canonicalSignature(encoderVer)
        ) {
            return member;
        }
    }

    return undefined;
}

function checkCompatibility(
    a: ContractDefinition,
    b: ContractDefinition,
    encoderVer: ABIEncoderVersion
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

            if (!compareVars(memberA, memberB, encoderVer)) {
                throw new Error(
                    `State variable "${a.name}.${
                        memberA.name
                    }" is not compatible instrumented member.\nSample: ${memberA.print()}\nResult: ${memberB.print()}`
                );
            }
        } else if (memberA instanceof FunctionDefinition) {
            const memberB = findCorrespondigFn(memberA, membersB, encoderVer);

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
        removeProcWd(fileName).replace(".instrumented.sol", ".sol")
    );

    it(`Source samples are present in ${samplesDir}`, () => {
        expect(samples.length).toBeGreaterThan(0);
    });

    for (const sample of samples) {
        describe(`Sample ${sample}`, () => {
            let artefact: string | undefined;
            let compilerVersion: string;
            let encoderVer: ABIEncoderVersion;
            let inAst: SourceUnit[];

            before(() => {
                const result = toAstUsingCache(sample);

                artefact = result.artefact;
                compilerVersion = result.compilerVersion;
                encoderVer = getABIEncoderVersion(result.units, compilerVersion);
                inAst = result.units;
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

                    checkCompatibility(inContract, outContract, encoderVer);
                }
            };

            it("Instrumented source in 'log' mode has compatible external interface", () => {
                let fileName: string;

                const args: string[] = [];

                if (artefact) {
                    fileName = artefact;

                    args.push("--input-mode", "json", "--compiler-version", compilerVersion);
                } else {
                    fileName = sample;
                }

                args.push("--debug-events");

                const result = toAst(sample + ".log.sol", scribble(fileName, ...args));

                compareSourceUnits(inAst, result.units);
            });

            it("Instrumented source in 'mstore' mode has compatible external interface", () => {
                let fileName: string;

                const args: string[] = [];

                if (artefact) {
                    fileName = artefact;

                    args.push("--input-mode", "json", "--compiler-version", compilerVersion);
                } else {
                    fileName = sample;
                }

                args.push("--user-assert-mode", "mstore");

                const result = toAst(sample + ".mstore.sol", scribble(fileName, ...args));

                compareSourceUnits(inAst, result.units);
            });
        });
    }
});
