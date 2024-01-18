import {
    assert,
    ASTNode,
    ContractDefinition,
    FunctionDefinition,
    InferType,
    SourceUnit,
    Statement,
    StatementWithChildren,
    StructuredDocumentation,
    bytesToString,
    VariableDeclaration
} from "solc-typed-ast";
import { SAnnotation } from "../spec-lang/ast/declarations/annotation";
import { parseAnnotation } from "../spec-lang/expr_parser";
import { indexToLocation, Location, Range } from "../util/location";
import { SourceFile, SourceMap } from "../util/sources";
import { AnnotationTarget } from "./annotations";

export interface Warning {
    msg: string;
    location: Range | Location;
}

/**
 * Helper function - find all matches for the regex `rx` inside the string `text` that
 * parse as valid annotations.
 */
function findAnnotationsInStr(
    doc: StructuredDocumentation,
    ctx: ASTNode,
    rx: RegExp,
    inference: InferType,
    file: SourceFile,
    fixer: (match: RegExpExecArray, text: string) => string
): Array<Range | Location> {
    const res: Array<Range | Location> = [];
    const text = bytesToString(doc.extractSourceFragment(file.rawContents));

    let match = rx.exec(text);

    const nodeOff = doc.sourceInfo.offset;

    while (match !== null) {
        let annotation: SAnnotation;

        try {
            annotation = parseAnnotation(
                fixer(match, text),
                ctx,
                inference,
                file,
                nodeOff + match.index
            );
        } catch {
            rx.lastIndex = match.index + 3;
            match = rx.exec(text);
            continue;
        }

        const rng = annotation.requiredRange;

        rx.lastIndex = match.index + rng.end.offset - rng.start.offset;

        res.push(indexToLocation(file, nodeOff + match.index));

        match = rx.exec(text);
    }

    return res;
}

export function findDeprecatedAnnotations(
    units: SourceUnit[],
    sources: SourceMap,
    inference: InferType
): Warning[] {
    const res: Warning[] = [];
    const rxs: Array<[RegExp, string, (match: RegExpExecArray, txt: string) => string]> = [
        // Old-style annotations without a '#'
        [
            /\s*(\*|\/\/\/)\s*[^#](if_succeeds|if_updated|if_assigned|invariant|assert|try|require|macro|define)/g,
            "The following looks like an annotation but was ignored due to # missing before first keyword. If it is an annotation please add '#' before first keyword.",
            (match, text) => {
                const keywordInd = text
                    .slice(match.index)
                    .search(
                        /if_succeeds|if_updated|if_assigned|invariant|assert|try|require|macro|define/
                    );
                return "* #" + text.slice(keywordInd);
            }
        ],
        // Old-style annotations with garbage before start'
        [
            /\s*(\*|\/\/\/)\s*[^\s#].*(if_succeeds|if_updated|if_assigned|invariant|assert|try|require|macro|define)/g,
            "The following looks like an annotation but was ignored due to garbage before first keyword",
            (match, text) => {
                const keywordInd = text
                    .slice(match.index)
                    .search(
                        /if_succeeds|if_updated|if_assigned|invariant|assert|try|require|macro|define/
                    );
                return "* #" + text.slice(keywordInd);
            }
        ],
        // All annotations with non-white text on the same line before @custom:scribble
        [
            /\s*(\*|\/\/\/).*[^\s].*@custom:scribble\s*#(if_succeeds|if_updated|if_assigned|invariant|assert|try|require|macro|define)/g,
            "The following looks like an annotation but was ignored due to garbage before '@custom:scribble' (see https://github.com/ethereum/solidity/issues/12245)",
            (match, text) => "* " + text.slice(text.slice(match.index).search("@custom:scribble"))
        ]
    ];

    for (const unit of units) {
        const file = sources.get(unit.sourceEntryKey);
        assert(file !== undefined, `Missing file for ${unit.sourceEntryKey}`);

        // Check no annotations on free functions
        for (const nd of unit.getChildrenBySelector(
            (child) =>
                (child instanceof ContractDefinition ||
                    child instanceof FunctionDefinition ||
                    child instanceof VariableDeclaration ||
                    child instanceof Statement ||
                    child instanceof StatementWithChildren) &&
                child.documentation instanceof StructuredDocumentation
        ) as AnnotationTarget[]) {
            const doc = nd.documentation as StructuredDocumentation;

            for (const [rx, msg, fixer] of rxs) {
                for (const location of findAnnotationsInStr(doc, nd, rx, inference, file, fixer)) {
                    res.push({ location, msg });
                }
            }
        }
    }

    return res;
}
