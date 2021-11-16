import { getABIEncoderVersion, SourceUnit } from "solc-typed-ast";
import { generateUtilsContract, ScribbleFactory } from "../../src";
import { getCallGraph } from "../../src/instrumenter/callgraph";
import { getCHA } from "../../src/instrumenter/cha";
import { InstrumentationContext } from "../../src/instrumenter/instrumentation_context";
import { TypeEnv } from "../../src/spec-lang/tc";

export function makeInstrumentationCtx(
    sources: SourceUnit[],
    factory: ScribbleFactory,
    files: Map<string, string>,
    assertionMode: "log" | "mstore",
    compilerVersion: string
): InstrumentationContext {
    const encVer = getABIEncoderVersion(sources, compilerVersion);

    const ctx = new InstrumentationContext(
        factory,
        sources,
        assertionMode,
        assertionMode === "mstore",
        true,
        getCallGraph(sources, encVer),
        getCHA(sources),
        {},
        [],
        new Map(),
        files,
        compilerVersion,
        false,
        new Map(),
        "flat",
        new TypeEnv(compilerVersion, encVer),
        new Map(),
        []
    );

    generateUtilsContract(factory, "", "scribble_utils.sol", compilerVersion, ctx).vContracts;

    return ctx;
}
