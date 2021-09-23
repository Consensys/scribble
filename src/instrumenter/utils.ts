import {
    AddressType,
    ArrayType,
    assert,
    ASTNode,
    ASTNodeFactory,
    Block,
    BoolType,
    BytesType,
    ContractDefinition,
    DataLocation,
    Expression,
    FixedBytesType,
    FunctionDefinition,
    FunctionKind,
    FunctionStateMutability,
    FunctionType,
    FunctionVisibility,
    generalizeType,
    Identifier,
    IntType,
    LiteralKind,
    MappingType,
    MemberAccess,
    Mutability,
    PointerType,
    SourceUnit,
    Statement,
    StatementWithChildren,
    StateVariableVisibility,
    StringType,
    StructDefinition,
    TypeName,
    TypeNode,
    UserDefinedType,
    VariableDeclaration
} from "solc-typed-ast";
import { getFQName, single, transpileType } from "..";
import { InstrumentationContext } from "./instrumentation_context";

export function needsLocation(type: TypeNode): boolean {
    return (
        type instanceof ArrayType ||
        type instanceof StringType ||
        type instanceof BytesType ||
        type instanceof MappingType ||
        (type instanceof UserDefinedType && type.definition instanceof StructDefinition)
    );
}

export function getTypeLocation(type: TypeNode, location?: DataLocation): DataLocation {
    if (type instanceof PointerType) {
        return type.location;
    }

    if (!needsLocation(type)) {
        return DataLocation.Default;
    }

    if (location === undefined) {
        throw new Error(`Type ${type.pp()} requires other location than "${location}"`);
    }

    return location;
}

/**
 * A sub-class of ASTNodeFactory containing some Scribble-specific AST building helpers.
 *
 * @todo Move to own file. This will likely grow
 */
export class ScribbleFactory extends ASTNodeFactory {
    /**
     * Creates and returns empty public constructor of `contract`
     */
    addConstructor(contract: ContractDefinition): FunctionDefinition {
        const emptyConstructor = this.makeFunctionDefinition(
            contract.id,
            FunctionKind.Constructor,
            "",
            false,
            FunctionVisibility.Public,
            FunctionStateMutability.NonPayable,
            true,
            this.makeParameterList([]),
            this.makeParameterList([]),
            [],
            undefined,
            this.makeBlock([])
        );

        contract.appendChild(emptyConstructor);

        return emptyConstructor;
    }

    /**
     * Return the constructor of `contract`.
     *
     * If there is no constructor defined,
     * add an empty public constructor and return it.
     */
    getOrAddConstructor(contract: ContractDefinition): FunctionDefinition {
        return contract.vConstructor ? contract.vConstructor : this.addConstructor(contract);
    }

    addEmptyFun(
        ctx: InstrumentationContext,
        name: string,
        visiblity: FunctionVisibility,
        container: ContractDefinition | SourceUnit
    ): FunctionDefinition {
        const body = this.makeBlock([]);
        const fn = this.makeFunctionDefinition(
            container.id,
            FunctionKind.Function,
            name,
            false,
            visiblity,
            FunctionStateMutability.NonPayable,
            false,
            this.makeParameterList([]),
            this.makeParameterList([]),
            [],
            undefined,
            body
        );

        container.appendChild(fn);

        ctx.addGeneralInstrumentation(body);

        return fn;
    }

    addStmt(
        loc: FunctionDefinition | Block,
        arg: Statement | StatementWithChildren<any> | Expression
    ): Statement {
        const body = loc instanceof FunctionDefinition ? (loc.vBody as Block) : loc;
        const stmt =
            arg instanceof Statement || arg instanceof StatementWithChildren
                ? arg
                : this.makeExpressionStatement(arg);

        body.appendChild(stmt);

        return stmt;
    }

    mkStructFieldAcc(
        base: Expression,
        struct: StructDefinition,
        idxArg: number | string
    ): MemberAccess {
        const field =
            typeof idxArg === "number"
                ? struct.vMembers[idxArg]
                : single(struct.vMembers.filter((field) => field.name === idxArg));

        return this.makeMemberAccess("<missing>", base, field.name, field.id);
    }

    addStructField(name: string, type: TypeNode, struct: StructDefinition): VariableDeclaration {
        const field = this.makeVariableDeclaration(
            false,
            false,
            name,
            struct.id,
            false,
            DataLocation.Default,
            StateVariableVisibility.Default,
            Mutability.Mutable,
            "<missing>",
            undefined,
            transpileType(type, this)
        );

        struct.appendChild(field);

        return field;
    }

    addFunArg(
        name: string,
        type: TypeNode | TypeName,
        location: DataLocation,
        fn: FunctionDefinition
    ): VariableDeclaration {
        const arg = this.makeVariableDeclaration(
            false,
            false,
            name,
            fn.id,
            false,
            location,
            StateVariableVisibility.Default,
            Mutability.Mutable,
            "<missing>",
            undefined,
            type instanceof TypeName ? type : transpileType(type, this)
        );

        fn.vParameters.appendChild(arg);

        return arg;
    }

    addFunRet(
        ctx: InstrumentationContext,
        name: string,
        type: TypeNode | TypeName,
        location: DataLocation,
        fn: FunctionDefinition
    ): VariableDeclaration {
        const arg = this.makeVariableDeclaration(
            false,
            false,
            name,
            fn.id,
            false,
            location,
            StateVariableVisibility.Default,
            Mutability.Mutable,
            "<missing>",
            undefined,
            type instanceof TypeName ? type : transpileType(type, this)
        );

        fn.vReturnParameters.appendChild(arg);

        ctx.addGeneralInstrumentation(arg);

        return arg;
    }

    mkLibraryFunRef(
        ctx: InstrumentationContext,
        fn: FunctionDefinition
    ): MemberAccess | Identifier {
        const ref =
            fn.visibility === FunctionVisibility.Private
                ? this.makeIdentifierFor(fn)
                : this.makeMemberAccess(
                      "<missing>",
                      this.makeIdentifierFor(fn.vScope as ContractDefinition),
                      fn.name,
                      fn.id
                  );

        ctx.addGeneralInstrumentation(ref);

        return ref;
    }

    generalizedTypeToTypeName(typ: TypeNode, atUseSite: ASTNode): TypeName {
        if (
            typ instanceof IntType ||
            typ instanceof BoolType ||
            typ instanceof AddressType ||
            typ instanceof BytesType ||
            typ instanceof StringType ||
            typ instanceof FixedBytesType
        ) {
            const payable = typ instanceof AddressType && typ.payable;
            return this.makeElementaryTypeName(
                "<missing>",
                typ.pp(),
                payable ? "payable" : "nonpayable"
            );
        }

        if (typ instanceof ArrayType) {
            return this.makeArrayTypeName(
                "<missing>",
                this.generalizedTypeToTypeName(typ.elementT, atUseSite),
                typ.size
                    ? this.makeLiteral("<misisng>", LiteralKind.Number, "", typ.size.toString(10))
                    : undefined
            );
        }

        if (typ instanceof MappingType) {
            return this.makeMapping(
                "<missing>",
                this.generalizedTypeToTypeName(typ.keyType, atUseSite),
                this.generalizedTypeToTypeName(typ.valueType, atUseSite)
            );
        }

        if (typ instanceof UserDefinedType) {
            return this.makeUserDefinedTypeName(
                "<missing>",
                getFQName(typ.definition, atUseSite),
                typ.definition.id
            );
        }

        if (typ instanceof FunctionType) {
            const params = typ.parameters.map((paramT) =>
                this.typeNodeToVariableDecl(paramT, "", atUseSite)
            );
            const rets = typ.returns.map((retT) =>
                this.typeNodeToVariableDecl(retT, "", atUseSite)
            );

            return this.makeFunctionTypeName(
                "<missing>",
                typ.visibility,
                typ.mutability,
                this.makeParameterList(params),
                this.makeParameterList(rets)
            );
        }

        assert(false, `generalizedTypeToTypeName: Unexpected generalized type ${typ.pp()}`);
    }

    typeNodeToVariableDecl(
        typ: TypeNode,
        name: string,
        atUseSite: ASTNode,
        constant = false,
        indexed = false,
        scope = -1,
        stateVar = false,
        visibility: StateVariableVisibility = StateVariableVisibility.Default,
        mutability: Mutability = Mutability.Mutable
    ): VariableDeclaration {
        const [generalTyp, loc] = generalizeType(typ);

        return this.makeVariableDeclaration(
            constant,
            indexed,
            name,
            scope,
            stateVar,
            loc ? loc : DataLocation.Default,
            visibility,
            mutability,
            generalTyp.pp(),
            undefined,
            this.generalizedTypeToTypeName(generalTyp, atUseSite)
        );
    }
}

/**
 * Base class for a 'structural equality' map. Normal TS map compare values with "==" and as
 * such objects are compared by identity. Sometimes we want to compare them 'structurally'.
 * Subclasses of this map must implement `getName` which maps any object(s) into a structural
 * descriptor (string or number).
 *
 * Note this class doesn't determine how values are set, as we have 2 use cases:
 *  - normal maps that set values
 *  - 'Factory' maps, that automatically generate values when not present
 */
export abstract class BaseStructMap<Args extends any[], KeyT extends string | number, ResT> {
    protected abstract getName(...args: Args): KeyT;
    protected _cache = new Map<KeyT, ResT>();
    protected _keys = new Map<KeyT, Args>();
    protected name?: string;

    constructor(name?: string) {
        this.name = name;
    }

    get(...args: Args): ResT | undefined {
        const name = this.getName(...args);

        return this._cache.get(name);
    }

    has(...args: Args): boolean {
        const name = this.getName(...args);

        return this._cache.has(name);
    }

    mustGet(...args: Args): ResT {
        const name = this.getName(...args);
        const res = this._cache.get(name);

        assert(
            res !== undefined,
            `Missing entry for ${name} in map ${this.name !== undefined ? this.name : ""}`
        );

        return res;
    }

    keys(): Iterable<Args> {
        return this._keys.values();
    }

    values(): Iterable<ResT> {
        return this._cache.values();
    }

    entries(): Iterable<[Args, ResT]> {
        const res: Array<[Args, ResT]> = [];

        for (const [key, value] of this._cache.entries()) {
            res.push([this._keys.get(key) as Args, value]);
        }

        return res;
    }
}

export abstract class StructMap<
    Args extends any[],
    KeyT extends string | number,
    ResT
> extends BaseStructMap<Args, KeyT, ResT> {
    set(res: ResT, ...args: Args): void {
        const key = this.getName(...args);

        this._cache.set(key, res);
        this._keys.set(key, args);
    }

    setExclusive(res: ResT, ...args: Args): void {
        const name = this.getName(...args);

        assert(!this._cache.has(name), `Name ${name} already appears in cache`);

        this._cache.set(name, res);
        this._keys.set(name, args);
    }
}

export abstract class FactoryMap<
    Args extends any[],
    KeyT extends string | number,
    ResT
> extends BaseStructMap<Args, KeyT, ResT> {
    protected abstract makeNew(...args: Args): ResT;

    get(...args: Args): ResT {
        const name = this.getName(...args);

        let res = this._cache.get(name);

        if (res === undefined) {
            res = this.makeNew(...args);

            this._cache.set(name, res);
            this._keys.set(name, args);
        }

        return res;
    }
}

/**
 * Helper function to generate valid function/variable/contract names based on
 * types.
 */
export function getTypeDesc(type: TypeNode): string {
    if (
        type instanceof IntType ||
        type instanceof StringType ||
        type instanceof BytesType ||
        type instanceof BoolType
    ) {
        return type.pp();
    }

    if (type instanceof AddressType) {
        return "address" + (type.payable ? "_payable" : "");
    }

    if (type instanceof ArrayType) {
        return (
            `${getTypeDesc(type.elementT)}_arr` + (type.size !== undefined ? `_${type.size}` : "")
        );
    }

    if (type instanceof UserDefinedType) {
        return `${type.name.replace(".", "_")}_${type.definition.id}`;
    }

    if (type instanceof MappingType) {
        return `mapping_${getTypeDesc(type.keyType)}_to_${getTypeDesc(type.valueType)}`;
    }

    if (type instanceof PointerType) {
        return getTypeDesc(type.to);
    }

    throw new Error(`Unknown type ${type.pp()} in getTypeDesc`);
}
