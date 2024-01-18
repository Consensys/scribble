import { InferType, SourceUnit } from "solc-typed-ast";
import { ScribbleFactory, SourceMap } from "../../src";
import { getCallGraph } from "../../src/instrumenter/callgraph";
import { getCHA } from "../../src/instrumenter/cha";
import {
    AssertionMode,
    InstrumentationContext
} from "../../src/instrumenter/instrumentation_context";
import { TypeEnv } from "../../src/spec-lang/tc";
import { SolFile } from "../../src/util/sources";

export function makeInstrumentationCtx(
    sources: SourceUnit[],
    factory: ScribbleFactory,
    files: Map<string, Uint8Array>,
    assertionMode: AssertionMode,
    compilerVersion: string
): InstrumentationContext {
    const inference = new InferType(compilerVersion);
    const srcFileMap: SourceMap = new Map(
        [...files.entries()].map(([name, contents]) => [name, new SolFile(name, contents)])
    );

    const ctx = new InstrumentationContext(
        factory,
        sources,
        assertionMode,
        assertionMode === "mstore",
        true,
        getCallGraph(inference, sources),
        getCHA(sources),
        {},
        [],
        new Map(),
        srcFileMap,
        compilerVersion,
        false,
        "flat",
        new TypeEnv(inference),
        new Map(),
        []
    );

    return ctx;
}
