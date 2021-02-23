import expect from "expect";
import fse from "fs-extra";
import {
    ASTKind,
    ASTNode,
    ASTReader,
    Identifier,
    ImportDirective,
    OverrideSpecifier,
    ParameterList,
    PragmaDirective,
    SourceUnit,
    StructuredDocumentation,
    TupleExpression
} from "solc-typed-ast";
import { searchRecursive, toAst } from "./utils";
import { scribble } from "./utils";
import { assert, pp, single } from "../../src/util";
import {
    parseSrcTriple,
    PropertyMap,
    SrcMapToSrcMap,
    contains,
    reNumber
} from "../../src/bin/json_output";

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

describe("Src2src map test", () => {
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
            let contents: string;
            let instrContents: string;
            let outJSON: any;
            let propMap: PropertyMap;
            let outAST: SourceUnit;
            let originalSrc2Node: Src2NodeMap;
            let instrSrc2Node: Src2NodeMap;
            let src2SrcMap: SrcMapToSrcMap;
            const coveredOriginalNodes = new Set<ASTNode>();

            before(() => {
                contents = fse.readFileSync(fileName, { encoding: "utf8" });
                [inAst] = toAst(fileName, contents);
                outJSON = JSON.parse(scribble(fileName, "--output-mode", "json"));
                propMap = outJSON.propertyMap;
                instrContents = outJSON["sources"]["flattened.sol"]["source"];
                const contentsMap = new Map<string, string>([["flattened.sol", instrContents]]);
                const reader = new ASTReader();
                [outAST] = reader.read(outJSON, ASTKind.Modern, contentsMap);

                src2SrcMap = outJSON.srcMap2SrcMap;
                originalSrc2Node = buildSrc2NodeMap(inAst, src2SrcMap.sourceList);
                instrSrc2Node = buildSrc2NodeMap([outAST]);
            });

            it("Src2src map maps nodes to nodes of same type", () => {
                for (const [instrRange, originalRange] of src2SrcMap.entries) {
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
                            // The only exception for finding an exact matching node
                            // in the original set is for callsite substitution
                            assert(
                                instrNode instanceof Identifier &&
                                    instrNode.name.startsWith(`_callsite_`),
                                `For nodes ${pp(instrNodes)} in ${instrRange} (${fragment(
                                    instrRange,
                                    instrContents
                                )}), no matching original node from ${pp(
                                    originalNodes
                                )} in ${originalRange} (${fragment(originalRange, contents)})`
                            );
                            const oldCallee = single([...originalNodes]);
                            oldCallee.walk((n) => coveredOriginalNodes.add(n));
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
                                        node instanceof OverrideSpecifier
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
        });
    }
});
