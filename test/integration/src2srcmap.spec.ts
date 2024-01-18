import expect from "expect";
import {
    assert,
    Assignment,
    ASTKind,
    ASTNode,
    ASTReader,
    Block,
    ContractDefinition,
    DataLocation,
    ExpressionStatement,
    FunctionCall,
    FunctionDefinition,
    Identifier,
    IdentifierPath,
    ImportDirective,
    IndexAccess,
    InlineAssembly,
    MemberAccess,
    OverrideSpecifier,
    ParameterList,
    fastParseBytecodeSourceMapping,
    PragmaDirective,
    SourceUnit,
    StructuredDocumentation,
    TupleExpression,
    TypeName,
    UnaryOperation,
    VariableDeclaration,
    FileMap,
    stringToBytes,
    bytesToString
} from "solc-typed-ast";
import {
    contains,
    forAll,
    forAny,
    InstrumentationMetaData,
    parseSrcTriple,
    PropertyMap,
    reNumber,
    searchRecursive,
    single
} from "../../src/util";
import { loc2Src, removeProcWd, scrSample, toAstUsingCache } from "./utils";

type Src2NodeMap = Map<string, Set<ASTNode>>;
function buildSrc2NodeMap(units: SourceUnit[], newSrcList?: string[]): Src2NodeMap {
    const res: Src2NodeMap = new Map();

    let newIdx: number;

    for (const unit of units) {
        if (newSrcList) {
            newIdx = newSrcList.indexOf(unit.absolutePath);

            assert(newIdx !== -1, "No entry for {0} in {1}", unit.absolutePath, newSrcList);
        }

        unit.walk((node) => {
            const src = newSrcList ? reNumber(node.src, newIdx) : node.src;
            const set = res.get(src);

            // There is a bug in solc where for return parameters such as `uint[] memory`
            // It considers their source to be just `uint[]` missing the location.
            // Account for this by adding the extra range here
            if (
                node instanceof VariableDeclaration &&
                node.parent instanceof ParameterList &&
                node.storageLocation !== DataLocation.Default &&
                node.name === ""
            ) {
                const t = parseSrcTriple(src);
                const widerSrc = `${t[0]}:${t[1] + 1 + node.storageLocation.length}:${t[2]}`;
                res.set(widerSrc, new Set([node]));
            }

            if (set) {
                set.add(node);
            } else {
                res.set(src, new Set([node]));
            }
        });
    }

    return res;
}

function fragment(src: string, contents: Uint8Array) {
    const [off, len] = parseSrcTriple(src);

    return bytesToString(contents.slice(off, off + len));
}

describe("Src2src map test", () => {
    const samplesDir = "test/samples/";

    const argMap = new Map<string, string[]>([
        ["test/samples/macro_erc20_nested_vars.sol", ["--macro-path", "test/samples/macros"]]
    ]);

    const samples = searchRecursive(samplesDir, (fileName) =>
        fileName.endsWith(".instrumented.sol")
    ).map((fileName) => removeProcWd(fileName).replace(".instrumented.sol", ".sol"));

    it(`Source samples are present in ${samplesDir}`, () => {
        expect(samples.length).toBeGreaterThan(0);
    });

    for (const sample of samples) {
        describe(sample, () => {
            let inAst: SourceUnit[];
            let contents: Uint8Array;
            let instrContents: Uint8Array;
            let outJSON: any;
            let propMap: PropertyMap;
            let outAST: SourceUnit;
            let originalSrc2Node: Src2NodeMap;
            let instrSrc2Node: Src2NodeMap;
            let instrMD: InstrumentationMetaData;
            const coveredOriginalNodes = new Set<ASTNode>();

            before(async () => {
                const result = await toAstUsingCache(sample);

                if (!result.files.has(sample)) {
                    throw new Error(`Missing source for ${sample} in files mapping`);
                }

                inAst = result.units;
                contents = result.files.get(sample) as Uint8Array;

                const args = [sample, "--output-mode", "json"];

                if (argMap.has(sample)) {
                    args.push(...(argMap.get(sample) as string[]));
                }
                outJSON = JSON.parse(scrSample(args[0], ...args.slice(1)));

                instrContents = stringToBytes(outJSON["sources"]["flattened.sol"]["source"]);

                const contentsMap: FileMap = new Map([["flattened.sol", instrContents]]);
                const reader = new ASTReader();

                [outAST] = reader.read(outJSON, ASTKind.Modern, contentsMap);

                instrMD = outJSON.instrumentationMetadata;
                propMap = instrMD.propertyMap;
                originalSrc2Node = buildSrc2NodeMap(inAst, instrMD.originalSourceList);
                instrSrc2Node = buildSrc2NodeMap([outAST]);
            });

            it("Src2src map maps nodes to nodes of same type", () => {
                for (const [instrRange, originalLoc] of instrMD.instrToOriginalMap) {
                    const instrNodes = instrSrc2Node.get(instrRange);
                    const originalRange = loc2Src(originalLoc);

                    assert(
                        instrNodes !== undefined,
                        'Instrumented range {0} (instr: "{1}", original {2}: "{3}") doesn\'t map to an ast node in instrumented code',
                        instrRange,
                        fragment(instrRange, instrContents),
                        originalRange,
                        fragment(originalRange, contents)
                    );

                    const originalNodes = originalSrc2Node.get(originalRange);

                    if (originalNodes === undefined) {
                        // If no matchin original node, then this
                        // mapping must map inside the body of one of the
                        // annotations
                        const containingProp = propMap.find((propDesc) =>
                            contains(loc2Src(propDesc.annotationSource), originalRange)
                        );

                        assert(
                            containingProp !== undefined,
                            "Missing original node for {0} {1}",
                            originalRange,
                            fragment(originalRange, contents)
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
                                            "Only ++/--/delete may be interposed for state vars"
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
                                            "Unexpected original node {0} in state var update site",
                                            node
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
                                    "For nodes {0} in {1} ({2}), no matching original node from {3} in {4} ({5})",
                                    instrNodes,
                                    instrRange,
                                    fragment(instrRange, instrContents),
                                    originalNodes,
                                    originalRange,
                                    fragment(originalRange, contents)
                                );

                                coveredOriginalNodes.add(originalNode);
                            } else {
                                assert(
                                    false,
                                    "For nodes {0} in {1} ({2}), no matching original node from {3} in {4} ({5})",
                                    instrNodes,
                                    instrRange,
                                    fragment(instrRange, instrContents),
                                    originalNodes,
                                    originalRange,
                                    fragment(originalRange, contents)
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
                            // 8) Mapping type names and identifier paths inside of state variables and some struct definitions that get re-written during map interposition
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
                                        node instanceof TypeName ||
                                        node instanceof IdentifierPath
                                    ) /* Override specifiers are moved on interposition */
                                )
                            ) {
                                assert(
                                    false,
                                    "Node {0} ({1}) from original not covered by AST map.",
                                    node,
                                    fragment(node.src, contents)
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
                // of a function. Additionally we skip anything inside of an inline assembly node
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

                const inlineAsmRanges = new Set<string>(
                    outAST.getChildrenByType(InlineAssembly, true).map((node) => node.src)
                );

                // Keep track of which `checkRange`s were hit for each property.
                // Each must be hit at least once by the bytecode map.
                const propertyChecksHit = new Set<string>();

                for (const fileName in outJSON["contracts"]) {
                    const fileJSON = outJSON["contracts"][fileName];
                    for (const contractName in fileJSON) {
                        const contractJSON = fileJSON[contractName];
                        const bytecodeMap = contractJSON.evm.bytecode.sourceMap;
                        const deployedBytecodeMap = contractJSON.evm.deployedBytecode.sourceMap;

                        // Interfaces and abstract contracts have empty source maps.
                        // Skip them.
                        if (bytecodeMap === "") {
                            continue;
                        }

                        // Since 0.7.2 builtin utility code has a source range with source index -1.
                        // Since 0.8.0 builtin utility code is emitted and has a positive source index 1 greater than the source list.
                        // Want to ignore utility code in both the bytecode and deployedBytecode maps
                        const bytecodeMapEntries = fastParseBytecodeSourceMapping(
                            bytecodeMap
                        ).filter(
                            (entry) =>
                                entry.sourceIndex !== -1 &&
                                entry.sourceIndex < instrMD.instrSourceList.length
                        );

                        const deployedBytecodeMapEntries = fastParseBytecodeSourceMapping(
                            deployedBytecodeMap
                        ).filter(
                            (entry) =>
                                entry.sourceIndex !== -1 &&
                                entry.sourceIndex < instrMD.instrSourceList.length
                        );

                        assert(
                            forAll(bytecodeMapEntries, (entry) => entry.sourceIndex === 0),
                            `Contract ${contractName} in ${fileName} has non-zero source indices in its bytecode map.`
                        );

                        assert(
                            forAll(deployedBytecodeMapEntries, (entry) => entry.sourceIndex === 0),
                            `Contract ${contractName} in ${fileName} has non-zero source indices in its deployedBytecodemap.`
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

                            // OR it must refer to a Yul node inside of an inline assembly vlock
                            if (forAny(inlineAsmRanges, (range) => contains(range, strEntry))) {
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
                                "Instrumented check location {0} ({1}) for property {2} is not found anywhere in the bytecode map",
                                checkRange,
                                fragment(checkRange, instrContents),
                                prop.id
                            );
                        }
                    });
                });
            });
        });
    }
});
