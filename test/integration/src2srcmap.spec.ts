import expect from "expect";
import {
    Assignment,
    ASTKind,
    ASTNode,
    ASTReader,
    Block,
    ContractDefinition,
    ExpressionStatement,
    FunctionCall,
    FunctionDefinition,
    Identifier,
    ImportDirective,
    IndexAccess,
    MemberAccess,
    OverrideSpecifier,
    ParameterList,
    PragmaDirective,
    SourceUnit,
    StructuredDocumentation,
    TupleExpression,
    TypeName,
    UnaryOperation
} from "solc-typed-ast";
import {
    assert,
    contains,
    forAll,
    forAny,
    InstrumentationMetaData,
    parseSrcTriple,
    pp,
    print,
    PropertyMap,
    reNumber,
    single
} from "../../src/util";
import { removeProcWd, scribble, searchRecursive, toAstUsingCache } from "./utils";

type Src2NodeMap = Map<string, Set<ASTNode>>;
function buildSrc2NodeMap(units: SourceUnit[], newSrcList?: string[]): Src2NodeMap {
    const res: Src2NodeMap = new Map();

    let newIdx: number;

    for (const unit of units) {
        if (newSrcList) {
            newIdx = newSrcList.indexOf(unit.absolutePath);

            assert(newIdx !== -1, `No entry for ${unit.absolutePath} in ${pp(newSrcList)}`);
        }

        unit.walk((node) => {
            const src = newSrcList ? reNumber(node.src, newIdx) : node.src;

            if (res.has(src)) {
                (res.get(src) as Set<ASTNode>).add(node);
            } else {
                res.set(src, new Set([node]));
            }
        });
    }

    return res;
}

function fragment(src: string, contents: string) {
    const [off, len] = parseSrcTriple(src);

    return contents.slice(off, off + len);
}

type DecodedBytecodeSourceMapEntry = {
    byteIndex: number;
    start: number;
    length: number;
    sourceIndex: number;
    jump: string;
};

function parseBytecodeSourceMapping(sourceMap: string): DecodedBytecodeSourceMapEntry[] {
    return sourceMap
        .split(";")
        .map((chunk) => chunk.split(":"))
        .map(([start, length, sourceIndex, jump]) => ({
            start: start === "" ? undefined : start,
            length: length === "" ? undefined : length,
            sourceIndex: sourceIndex === "" ? undefined : sourceIndex,
            jump: jump === "" ? undefined : jump
        }))
        .reduce(
            ([previous, ...all], entry) => [
                {
                    start: parseInt(entry.start || previous.start, 10),
                    length: parseInt(entry.length || previous.length, 10),
                    sourceIndex: parseInt(entry.sourceIndex || previous.sourceIndex, 10),
                    jump: entry.jump || previous.jump
                },
                previous,
                ...all
            ],
            [{} as any]
        )
        .reverse()
        .slice(1);
}

describe("Src2src map test", () => {
    const samplesDir = "test/samples/";
    const samples = searchRecursive(samplesDir, /(?<=\.instrumented)\.sol$/).map((fileName) =>
        removeProcWd(fileName).replace(".instrumented.sol", ".sol")
    );

    it(`Source samples are present in ${samplesDir}`, () => {
        expect(samples.length).toBeGreaterThan(0);
    });

    for (const sample of samples) {
        describe(`Sample ${sample}`, () => {
            let inAst: SourceUnit[];
            let contents: string;
            let instrContents: string;
            let outJSON: any;
            let propMap: PropertyMap;
            let outAST: SourceUnit;
            let originalSrc2Node: Src2NodeMap;
            let instrSrc2Node: Src2NodeMap;
            let instrMD: InstrumentationMetaData;
            const coveredOriginalNodes = new Set<ASTNode>();

            before(() => {
                const result = toAstUsingCache(sample);

                if (!result.files.has(sample)) {
                    throw new Error(`Missing source for ${sample} in files mapping`);
                }

                inAst = result.units;
                contents = result.files.get(sample) as string;

                let fileName: string;

                const args: string[] = [];

                if (result.artefact) {
                    fileName = result.artefact;

                    args.push("--input-mode", "json", "--compiler-version", result.compilerVersion);
                } else {
                    fileName = sample;
                }

                args.push("--output-mode", "json");

                outJSON = JSON.parse(scribble(fileName, ...args));
                instrContents = outJSON["sources"]["flattened.sol"]["source"];

                const contentsMap = new Map<string, string>([["flattened.sol", instrContents]]);
                const reader = new ASTReader();

                [outAST] = reader.read(outJSON, ASTKind.Modern, contentsMap);

                instrMD = outJSON.instrumentationMetadata;
                propMap = instrMD.propertyMap;
                originalSrc2Node = buildSrc2NodeMap(inAst, instrMD.originalSourceList);
                instrSrc2Node = buildSrc2NodeMap([outAST]);
            });

            it("Src2src map maps nodes to nodes of same type", () => {
                for (const [instrRange, originalRange] of instrMD.instrToOriginalMap) {
                    const instrNodes = instrSrc2Node.get(instrRange);

                    if (instrNodes === undefined) {
                        assert(
                            false,
                            `Instrumented range ${instrRange} (instr: "${fragment(
                                instrRange,
                                instrContents
                            )}", original ${originalRange}: "${fragment(
                                originalRange,
                                contents
                            )}") doesn't map to an ast node in instrumented code`
                        );
                    }

                    const originalNodes = originalSrc2Node.get(originalRange);

                    if (originalNodes === undefined) {
                        // If no matchin original node, then this
                        // mapping must map inside the body of one of the
                        // annotations
                        const containingProp = propMap.find((propDesc) =>
                            contains(propDesc.annotationSource, originalRange)
                        );

                        assert(
                            containingProp !== undefined,
                            `Missing original node for ${originalRange} ${fragment(
                                originalRange,
                                contents
                            )}`
                        );

                        continue;
                    }

                    // We expect that for each node in `instrNodes` there is a matching node at least by type
                    for (const instrNode of instrNodes) {
                        let matchingOrignal = [...originalNodes].find(
                            (originalNode) => instrNode.constructor === originalNode.constructor
                        );

                        /**
                         * Handle the case where the writer emitted extra ()
                         */
                        if (
                            matchingOrignal === undefined &&
                            instrNode instanceof TupleExpression &&
                            instrNode.vComponents.length === 1 &&
                            !instrNode.isInlineArray
                        ) {
                            const innerExp = instrNode.vComponents[0];
                            matchingOrignal = [...originalNodes].find(
                                (originalNode) => innerExp.constructor === originalNode.constructor
                            );
                        }

                        if (matchingOrignal === undefined) {
                            // There are several exceptions for this:
                            // 1) State var update substitutions - (those are substituted with function calls)
                            // 2) Callsite substitutions
                            // 3) Converting a type Identifier to a MemberAccess
                            // 4) Substituting an expression with a temporary on the LHS of a tuple assignment
                            if (
                                instrNode instanceof Identifier &&
                                instrNode.name.startsWith(`_callsite_`)
                            ) {
                                const oldCallee = single([...originalNodes]);
                                oldCallee.walk((n) => coveredOriginalNodes.add(n));
                            } else if (instrNode instanceof FunctionCall) {
                                for (const node of originalNodes) {
                                    if (node instanceof ExpressionStatement) {
                                        // nothing to do
                                    } else if (node instanceof Assignment) {
                                        for (const child of node.vLeftHandSide.getChildren(true)) {
                                            coveredOriginalNodes.add(child);
                                        }
                                    } else if (node instanceof UnaryOperation) {
                                        assert(
                                            ["++", "--", "delete"].includes(node.operator),
                                            `Only ++/--/delete may be interposed for state vars`
                                        );
                                        for (const child of node.vSubExpression.getChildren(true)) {
                                            coveredOriginalNodes.add(child);
                                        }
                                    } else if (node instanceof IndexAccess) {
                                        for (const child of node.getChildren(true)) {
                                            coveredOriginalNodes.add(child);
                                        }
                                    } else {
                                        assert(
                                            false,
                                            `Unexpected original node ${print(
                                                node
                                            )} in state var update site`
                                        );
                                    }

                                    coveredOriginalNodes.add(node);
                                }
                            } else if (
                                forAll(originalNodes, (node) => {
                                    const tuple = node.getClosestParentByType(TupleExpression);

                                    if (tuple === undefined) {
                                        return false;
                                    }

                                    const assignment = tuple.getClosestParentByType(Assignment);

                                    // @todo chech that we are a left chidl of assignment here
                                    return assignment !== undefined;
                                })
                            ) {
                                for (const original of originalNodes) {
                                    for (const child of original.getChildren(true)) {
                                        coveredOriginalNodes.add(child);
                                    }
                                }
                            } else if (
                                instrNode instanceof MemberAccess &&
                                originalNodes.size === 1
                            ) {
                                const originalNode = single([...originalNodes]);
                                assert(
                                    originalNode instanceof Identifier &&
                                        instrNode.memberName === originalNode.name &&
                                        instrNode.vExpression instanceof Identifier &&
                                        instrNode.vExpression.vReferencedDeclaration instanceof
                                            ContractDefinition,
                                    `For nodes ${pp(instrNodes)} in ${instrRange} (${fragment(
                                        instrRange,
                                        instrContents
                                    )}), no matching original node from ${pp(
                                        originalNodes
                                    )} in ${originalRange} (${fragment(originalRange, contents)})`
                                );

                                coveredOriginalNodes.add(originalNode);
                            } else {
                                assert(
                                    false,
                                    `For nodes ${pp(instrNodes)} in ${instrRange} (${fragment(
                                        instrRange,
                                        instrContents
                                    )}), no matching original node from ${pp(
                                        originalNodes
                                    )} in ${originalRange} (${fragment(originalRange, contents)})`
                                );
                            }
                        } else {
                            coveredOriginalNodes.add(matchingOrignal);
                        }
                    }
                }
            });

            it("Src2src map covers all relevant AST nodes in original file", () => {
                for (const unit of inAst) {
                    unit.walk((node) => {
                        if (!coveredOriginalNodes.has(node)) {
                            // There are several cases of original AST nodes that don't
                            // have a corresponding node in the flattened instrumented output
                            // 1) SourceUnits - may be removed in flat mode
                            // 2) PragmaDirectives - maybe removed in flat mode
                            // 3) ImportDirectives - maybe removed in flat mode
                            // 4) StructureDocumentations - are stripped
                            // 5) Empty ParamterLists (especiall in return params) may be removed
                            // 6) OverrideSpecifiers are moved on interposition
                            // 7) .push() and .pop() callees that are interposed
                            // 8) Mapping type names inside of state variables and some struct definitions that get re-written during map interposition
                            if (
                                !(
                                    (
                                        node instanceof SourceUnit || // No original SourceUnits after flattening
                                        node instanceof PragmaDirective || // Compiler version pragma directives are stripped
                                        node instanceof ImportDirective || // Import directives are stripped
                                        node instanceof StructuredDocumentation || // Structured docs are stripped
                                        (node instanceof ParameterList &&
                                            node.vParameters.length ==
                                                0) /* Empty parameter lists */ ||
                                        node instanceof OverrideSpecifier ||
                                        (node instanceof MemberAccess &&
                                            ["push", "pop"].includes(node.memberName)) ||
                                        (node.parent instanceof MemberAccess &&
                                            ["push", "pop"].includes(node.parent.memberName)) ||
                                        node instanceof TypeName
                                    ) /* Override specifiers are moved on interposition */
                                )
                            ) {
                                assert(
                                    false,
                                    `Node ${pp(node)} (${fragment(
                                        node.src,
                                        contents
                                    )}) from original not covered by AST map.`
                                );
                            }
                        }
                    });
                }
            });

            it("All assertion ranges are inside of an instrumentation range", () => {
                assert(
                    forAll(instrMD.propertyMap, (prop) =>
                        forAll(prop.assertionRanges, (assertionRange) =>
                            forAny(prop.instrumentationRanges, (instrRange) =>
                                contains(instrRange, assertionRange)
                            )
                        )
                    ),
                    "Some assertion ranges are out of instrumentation ranges (they shouldn't be)"
                );
            });

            it("Bytecode map is covered by instrumentation metadata", () => {
                // Some compiler-generated code maps to the whole file. Skip it.
                const src2SrcMap = new Map(instrMD.instrToOriginalMap);

                // Need to skip some compiler-generated bytecode. Specifically any
                // bytecode related to entire functions, contracts or (as of 0.8.6) the entire body
                // of a function
                const skipSrcs = new Set<string>();
                for (const node of outAST.getChildrenBySelector(
                    (node) =>
                        node instanceof ContractDefinition ||
                        node instanceof FunctionDefinition ||
                        (node instanceof Block && node.parent instanceof FunctionDefinition),
                    true
                )) {
                    skipSrcs.add(node.src);
                }

                // Keep track of which `checkRange`s were hit for each property.
                // Each must be hit at least once by the bytecode map.
                const propertyChecksHit = new Set<string>();

                for (const fileName in outJSON["contracts"]) {
                    const fileJSON = outJSON["contracts"][fileName];
                    for (const contractName in fileJSON) {
                        const contractJSON = fileJSON[contractName];
                        const bytecodeMap = contractJSON.evm.bytecode.sourceMap;
                        const deployedBytecodeMap = contractJSON.evm.deployedBytecode.sourceMap;

                        // Since 0.7.2 builtin utility code has a source range with source index -1.
                        // Since 0.8.0 builtin utility code is emitted and has a positive source index 1 greater than the source list.
                        // Want to ignore utility code in both the bytecode and deployedBytecode maps
                        const bytecodeMapEntries = parseBytecodeSourceMapping(bytecodeMap).filter(
                            (entry) =>
                                entry.sourceIndex !== -1 &&
                                entry.sourceIndex < instrMD.instrSourceList.length
                        );

                        const deployedBytecodeMapEntries = parseBytecodeSourceMapping(
                            deployedBytecodeMap
                        ).filter(
                            (entry) =>
                                entry.sourceIndex !== -1 &&
                                entry.sourceIndex < instrMD.instrSourceList.length
                        );

                        // Interfaces have weird source maps. Skip them
                        if (
                            bytecodeMapEntries.length === 1 &&
                            isNaN(bytecodeMapEntries[0].sourceIndex)
                        ) {
                            continue;
                        }

                        assert(
                            forAll(bytecodeMapEntries, (entry) => entry.sourceIndex === 0),
                            `Contract ${contractName} in ${fileName} has non-zero source inidices in its bytecode map.`
                        );

                        assert(
                            forAll(deployedBytecodeMapEntries, (entry) => entry.sourceIndex === 0),
                            `Contract ${contractName} in ${fileName} has non-zero source inidices in its deployedBytecodemap.`
                        );

                        const missing = new Set<string>();

                        for (const entry of bytecodeMapEntries.concat(deployedBytecodeMapEntries)) {
                            const strEntry = `${entry.start}:${entry.length}:${entry.sourceIndex}`;

                            // For every bytecode source map entry, EITHER it must EXACTLY match an entry in the src2src map
                            if (src2SrcMap.has(strEntry)) {
                                continue;
                            }

                            if (skipSrcs.has(strEntry)) {
                                continue;
                            }

                            // Check if this source map entry corresponds to
                            // some property check condition, and mark it
                            instrMD.propertyMap.forEach((prop, propIdx) => {
                                prop.checkRanges.forEach((checkRange, checkRangeIdx) => {
                                    if (contains(checkRange, strEntry)) {
                                        const key = `${propIdx}_${checkRangeIdx}`;

                                        propertyChecksHit.add(key);
                                    }
                                });
                            });

                            // OR it must be part of the instrumentation of some property
                            if (
                                forAny(instrMD.propertyMap, (prop) =>
                                    forAny(prop.instrumentationRanges, (range) =>
                                        contains(range, strEntry)
                                    )
                                )
                            ) {
                                continue;
                            }

                            // OR it must be part of the general instrumentation
                            if (
                                forAny(instrMD.otherInstrumentation, (range) =>
                                    contains(range, strEntry)
                                )
                            ) {
                                continue;
                            }

                            missing.add(strEntry);
                        }

                        for (const strEntry of missing) {
                            console.log(
                                `Bytecode entry ${strEntry} for ${fileName}:${contractName} corresponding to ${fragment(
                                    strEntry,
                                    instrContents
                                )} not covered`
                            );
                        }

                        assert(
                            missing.size === 0,
                            `Bytecode map for ${fileName} ${contractName} has missing entries.`
                        );
                    }
                }

                instrMD.propertyMap.forEach((prop, propIdx) => {
                    prop.checkRanges.forEach((checkRange, checkRangeIdx) => {
                        const key = `${propIdx}_${checkRangeIdx}`;

                        if (!propertyChecksHit.has(key)) {
                            assert(
                                false,
                                `Instrumented check location ${checkRange} (${fragment(
                                    checkRange,
                                    instrContents
                                )}) for property ${
                                    prop.id
                                } is not found anywhere in the bytecode map`
                            );
                        }
                    });
                });
            });
        });
    }
});
