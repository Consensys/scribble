import {
    ArrayTypeName,
    ContractDefinition,
    DataLocation,
    ElementaryTypeName,
    EnumDefinition,
    Mapping,
    StructDefinition,
    TypeName,
    UserDefinedTypeName
} from "solc-typed-ast";
import { assert, print } from "..";

function fqName(e: EnumDefinition | StructDefinition): string {
    return `${e.vScope instanceof ContractDefinition ? e.vScope.name + "." : ""}${e.name}`;
}

/**
 * Return a `typeString` similar to what Solidity generates in the AST for the specified `typeName` and `loc`
 */
export function makeTypeString(typeName: TypeName, loc: DataLocation): string {
    if (typeName instanceof ElementaryTypeName) {
        if (["bytes", "string"].includes(typeName.name)) {
            assert(loc !== DataLocation.Default, `${typeName.name} requires location`);
            return `${typeName.name} ${loc} ref`;
        }

        if (typeName.name === "address") {
            return `address${typeName.stateMutability === "payable" ? " payable" : ""}`;
        }

        return typeName.name;
    }

    if (typeName instanceof ArrayTypeName) {
        assert(loc !== undefined, `${print(typeName)} requires location`);
        const baseString = makeTypeString(typeName.vBaseType, loc);
        return `${baseString}[${
            typeName.vLength !== undefined ? print(typeName.vLength) : ""
        }] ${loc} ref`;
    }

    if (typeName instanceof Mapping) {
        assert(loc === DataLocation.Storage, `${print(typeName)} requires storage location`);
        return `mapping(${makeTypeString(
            typeName.vKeyType,
            DataLocation.Memory
        )} => ${makeTypeString(typeName.vValueType, loc)})`;
    }

    if (typeName instanceof UserDefinedTypeName) {
        const def = typeName.vReferencedDeclaration;
        if (def instanceof ContractDefinition) {
            return `contract ${def.name}`;
        }

        if (def instanceof EnumDefinition) {
            return `enum ${fqName(def)}`;
        }

        if (def instanceof StructDefinition) {
            assert(loc !== DataLocation.Default, `${print(typeName)} requires storage location`);
            return `struct ${fqName(def)} ${loc} ref`;
        }
    }

    throw new Error(`NYI typename ${print(typeName)}`);
}
