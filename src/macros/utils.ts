import { parse as typeStringParse, TypeNode } from "solc-typed-ast";
import YAML from "yaml";
import { SourceFile } from "../util/sources";

export interface MacroSchema {
    [name: string]: {
        variables: {
            [name: string]: string;
        };
        properties: {
            [signature: string]: Array<{
                msg: string;
                prop: string;
            }>;
        };
    };
}

export interface MacroVariable {
    name: string;
    originalType: string;
    type: TypeNode;
}

export interface MacroProperty {
    message: string;
    expression: string;
}

export interface MacroDefinition {
    source: SourceFile;
    variables: Map<string, MacroVariable>;
    properties: Map<string, MacroProperty[]>;
}

export function readMacroDefinitions(source: SourceFile, defs: Map<string, MacroDefinition>): void {
    const schema: MacroSchema = YAML.parse(source.contents);

    for (const [name, macro] of Object.entries(schema)) {
        const variables = new Map<string, MacroVariable>();

        for (const [name, originalType] of Object.entries(macro.variables)) {
            const type: TypeNode = typeStringParse(originalType, {});

            variables.set(name, { name, originalType, type });
        }

        const properties = new Map<string, MacroProperty[]>();

        for (const [signature, originalProps] of Object.entries(macro.properties)) {
            const props: MacroProperty[] = originalProps.map((entry) => ({
                message: entry.msg,
                expression: entry.prop
            }));

            properties.set(signature, props);
        }

        defs.set(name, { variables, properties, source });
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
