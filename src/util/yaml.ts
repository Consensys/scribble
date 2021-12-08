import { Scalar, YAMLMap, YAMLSeq } from "yaml/types";
import { PPAbleError } from "./errors";
import { Location, Range } from "./location";
import { MacroFile } from "./sources";
import YAML from "yaml";
import { single } from "./misc";
import { assert } from "solc-typed-ast";

const srcloc = require("src-location");

export class YamlSchemaError extends PPAbleError {}

function makeYamlLoc(off: number, file: MacroFile): Location {
    const t = srcloc.indexToLocation(file.contents, off);
    const { line, column } = t;
    return {
        offset: off,
        line,
        column,
        file
    };
}

/// Turn a YAML range into our internal range. Note that yaml ranges are [start, end], not [start, len]
export function makeYamlRange(range: [number, number], file: MacroFile): Range {
    return { start: makeYamlLoc(range[0], file), end: makeYamlLoc(range[1], file) };
}

/**
 * Check that a parsed YAML `node` adheres to the given schema. We specify the schema as a JSON object. For example the below object:
 * {
 *  "a": "string",
 *  "*": {
 *      "b": "number",
 *      "c": [{
 *          "d": "string"
 *      }]
 *  }
 * }
 *
 * Specifies that:
 * 1. The top-level yaml node should be a map
 * 2. The top-level yaml node should have at least 1 entry "a" which is a scalar string
 * 3. Any other entries in the top-level yaml node must be yaml maps too
 * 4. Objects for other entries in the top-level yaml node must have two keys - "b" and "c"
 * 5. Values for the "b" key must be scalar numbers
 * 6. Values for the "c" key must be sequences, containing maps with a single key "d" which is a scalar string.
 */
export function checkYamlSchema(
    node: YAMLMap | YAMLSeq | Scalar | null,
    schema: any,
    file: MacroFile
): void {
    if (node === null) {
        // Empty arrays ok
        if (schema instanceof Array) {
            return;
        }

        // Empty maps with no required entries are ok
        if (schema instanceof Object) {
            const keys = Object.keys(schema);
            if (keys.length === 1 && keys[0] === "*") {
                return;
            }
        }

        throw new YamlSchemaError(
            `Unexpected empty node in ${file.fileName}. Expected a match for ${JSON.stringify(
                schema
            )}`,
            makeYamlRange([0, file.contents.length], file)
        );
    }

    if (schema instanceof Array) {
        if (!(node instanceof YAMLSeq)) {
            throw new YamlSchemaError(
                `Expected sequence not ${YAML.stringify(node)}`,
                makeYamlRange(node.range as [number, number], file)
            );
        }

        const elementSchema = single(
            schema,
            `Internal error: Schema array definitions should only have 1 element, not ${schema.length}`
        );

        for (const item of node.items) {
            checkYamlSchema(item, elementSchema, file);
        }
    } else if (schema instanceof Object) {
        if (!(node instanceof YAMLMap)) {
            throw new YamlSchemaError(
                `Expected map not ${YAML.stringify(node)}`,
                makeYamlRange(node.range as [number, number], file)
            );
        }

        const itemMap = new Map<string, any>(
            node.items.map((p) => [p.key.value as string, p.value])
        );

        let wildcardSchema: any = undefined;
        const explicitKeys = new Set<string>();

        for (const [key, val] of Object.entries(schema)) {
            if (key == "*") {
                wildcardSchema = val;
                continue;
            }

            explicitKeys.add(key);

            if (!itemMap.has(key)) {
                throw new YamlSchemaError(
                    `Missing key ${key}`,
                    makeYamlRange(node.range as [number, number], file)
                );
            }

            checkYamlSchema(itemMap.get(key) as YAMLMap | YAMLSeq | Scalar, val, file);
        }

        if (wildcardSchema !== undefined) {
            for (const [key, val] of itemMap.entries()) {
                if (explicitKeys.has(key)) {
                    continue;
                }

                checkYamlSchema(val as YAMLMap | YAMLSeq | Scalar, wildcardSchema, file);
            }
        }
    } else {
        assert(typeof schema === "string", `Internal Error: Unknown schema {0}`, schema);
        if (!(node instanceof Scalar)) {
            throw new YamlSchemaError(
                `Expected a scalar ${schema} value, not ${YAML.stringify(node)}`,
                makeYamlRange(node.range as [number, number], file)
            );
        }

        if (schema == "string") {
            if (!(typeof node.value === "string")) {
                throw new YamlSchemaError(
                    `Expected a scalar ${schema} value, not ${YAML.stringify(node)}`,
                    makeYamlRange(node.range as [number, number], file)
                );
            }
        } else if (schema == "number") {
            if (!(typeof node.value === "number")) {
                throw new YamlSchemaError(
                    `Expected a scalar ${schema} value, not ${YAML.stringify(node)}`,
                    makeYamlRange(node.range as [number, number], file)
                );
            }
        } else {
            throw new Error(`NYI schema scalar type ${schema}`);
        }
    }
}
