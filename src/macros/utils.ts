import { parse as typeStringParse, TypeNode } from "solc-typed-ast";
import YAML from "yaml";

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
    variables: Map<string, MacroVariable>;
    properties: Map<string, MacroProperty[]>;
}

export function readMacroDefinitions(source: string, defs: Map<string, MacroDefinition>): void {
    const schema: MacroSchema = YAML.parse(source);

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

        defs.set(name, { variables, properties });
    }
}
