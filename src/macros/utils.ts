import { parse as typeStringParse, TypeNode } from "solc-typed-ast";
import YAML from "yaml";
import { Scalar, YAMLMap, YAMLSeq } from "yaml/types";
import { SourceFile } from "../util/sources";
import { checkYamlSchema, makeYamlRange, YamlSchemaError } from "../util/yaml";

export interface MacroVariable {
    name: string;
    originalType: string;
    type: TypeNode;
}

export interface MacroProperty {
    message: string;
    expression: string;
    offset: number;
}

export interface MacroDefinition {
    source: SourceFile;
    variables: Map<string, MacroVariable>;
    properties: Map<string, MacroProperty[]>;
}

const yamlMacroSchema = {
    "*": {
        variables: {
            "*": "string"
        },
        properties: {
            "*": [
                {
                    msg: "string",
                    prop: "string"
                }
            ]
        }
    }
};

export function readMacroDefinitions(source: SourceFile, defs: Map<string, MacroDefinition>): void {
    const document = YAML.parseDocument(source.contents);

    if (document.contents === null) {
        throw new YamlSchemaError(
            `Unexpected empty document ${source.contents}`,
            makeYamlRange([0, source.contents.length], source)
        );
    }

    checkYamlSchema(document.contents, yamlMacroSchema, source);

    for (const item of (document.contents as YAMLMap).items) {
        const macroName = item.key.value as string;
        const macroBody = item.value as YAMLMap;
        const macroVars = macroBody.get("variables") as YAMLMap;
        const macroProps = macroBody.get("properties") as YAMLMap;

        const variables = new Map<string, MacroVariable>();

        for (const variableItem of macroVars.items) {
            const name = variableItem.key.value as string;
            const originalType = (variableItem.value as Scalar).value as string;
            const type: TypeNode = typeStringParse(originalType, {});

            variables.set(name, { name, originalType, type });
        }

        const properties = new Map<string, MacroProperty[]>();

        for (const propItem of macroProps.items) {
            const signature = propItem.key.value as string;
            const propSeq = propItem.value as YAMLSeq;

            const props: MacroProperty[] = [];

            for (const propBody of propSeq.items) {
                const message = (propBody as YAMLMap).get("msg");
                const expression = (propBody as YAMLMap).get("prop", true) as Scalar;
                const offset = (expression.range as [number, number])[0];

                props.push({
                    message,
                    expression: expression.value as string,
                    offset
                });
            }

            properties.set(signature, props);
        }

        defs.set(macroName, { variables, properties, source });
    }
}

export function parseMacroMethodSignature(signature: string): [string, string[]] {
    const idxOpen = signature.indexOf("(");
    const idxClose = signature.indexOf(")", idxOpen);

    const name = signature.slice(0, idxOpen);
    const argsSlice = signature.slice(idxOpen + 1, idxClose).trim();
    const args = argsSlice.length === 0 ? [] : argsSlice.split(",").map((arg) => arg.trim());

    return [name, args];
}
