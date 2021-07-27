import {
    FunctionVisibility,
    ContractDefinition,
    SourceUnit,
    FunctionDefinition,
    FunctionKind,
    FunctionStateMutability,
    Block,
    ASTNodeFactory,
    Statement,
    StatementWithChildren,
    Expression,
    StructDefinition,
    MemberAccess,
    assert,
    TypeNode,
    AddressType,
    ArrayType,
    BoolType,
    BytesType,
    IntType,
    MappingType,
    PointerType,
    StringType,
    UserDefinedType,
    DataLocation,
    Mutability,
    StateVariableVisibility,
    VariableDeclaration,
    Identifier
} from "solc-typed-ast";
import { single, transpileType } from "..";
import { InstrumentationContext } from "./instrumentation_context";

export function addEmptyFun(
    ctx: InstrumentationContext,
    name: string,
    visiblity: FunctionVisibility,
    container: ContractDefinition | SourceUnit
): FunctionDefinition {
    const factory = ctx.factory;
    const fun = factory.makeFunctionDefinition(
        container.id,
        FunctionKind.Function,
        name,
        false,
        visiblity,
        FunctionStateMutability.NonPayable,
        false,
        factory.makeParameterList([]),
        factory.makeParameterList([]),
        [],
        undefined,
        factory.makeBlock([])
    );
    container.appendChild(fun);

    ctx.addGeneralInstrumentation(fun.vBody as Block);
    return fun;
}

export function addStmt(
    factory: ASTNodeFactory,
    loc: FunctionDefinition | Block,
    arg: Statement | StatementWithChildren<any> | Expression
): Statement {
    const body = loc instanceof FunctionDefinition ? (loc.vBody as Block) : loc;
    const stmt =
        arg instanceof Statement || arg instanceof StatementWithChildren
            ? arg
            : factory.makeExpressionStatement(arg);
    body.appendChild(stmt);
    return stmt;
}

export function mkStructFieldAcc(
    factory: ASTNodeFactory,
    base: Expression,
    struct: StructDefinition,
    idxArg: number | string
): MemberAccess {
    const field =
        typeof idxArg === "number"
            ? struct.vMembers[idxArg]
            : single(struct.vMembers.filter((field) => field.name === idxArg));
    return factory.makeMemberAccess("<missing>", base, field.name, field.id);
}

export function addStructField(
    factory: ASTNodeFactory,
    name: string,
    typ: TypeNode,
    struct: StructDefinition
): VariableDeclaration {
    const field = factory.makeVariableDeclaration(
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
        transpileType(typ, factory)
    );
    struct.appendChild(field);
    return field;
}

export function addFunArg(
    factory: ASTNodeFactory,
    name: string,
    typ: TypeNode,
    location: DataLocation,
    fun: FunctionDefinition
): VariableDeclaration {
    const arg = factory.makeVariableDeclaration(
        false,
        false,
        name,
        fun.id,
        false,
        location,
        StateVariableVisibility.Default,
        Mutability.Mutable,
        "<missing>",
        undefined,
        transpileType(typ, factory)
    );

    fun.vParameters.appendChild(arg);
    return arg;
}

export function addFunRet(
    ctx: InstrumentationContext,
    name: string,
    typ: TypeNode,
    location: DataLocation,
    fun: FunctionDefinition
): VariableDeclaration {
    const factory = ctx.factory;
    const arg = factory.makeVariableDeclaration(
        false,
        false,
        name,
        fun.id,
        false,
        location,
        StateVariableVisibility.Default,
        Mutability.Mutable,
        "<missing>",
        undefined,
        transpileType(typ, factory)
    );

    fun.vReturnParameters.appendChild(arg);
    ctx.addGeneralInstrumentation(arg);
    return arg;
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

    public get(...args: Args): ResT | undefined {
        const name = this.getName(...args);
        return this._cache.get(name);
    }

    public has(...args: Args): boolean {
        const name = this.getName(...args);
        return this._cache.has(name);
    }

    public mustGet(...args: Args): ResT {
        const name = this.getName(...args);
        const res = this._cache.get(name);

        if (res === undefined) {
            assert(
                false,
                `Missing entry for ${name} in map ${this.name !== undefined ? this.name : ""}`
            );
        }
        return res;
    }

    public keys(): Iterable<Args> {
        return this._keys.values();
    }

    public values(): Iterable<ResT> {
        return this._cache.values();
    }

    public entries(): Iterable<[Args, ResT]> {
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
    public set(res: ResT, ...args: Args): void {
        const key = this.getName(...args);
        this._cache.set(key, res);
        this._keys.set(key, args);
    }

    public setExclusive(res: ResT, ...args: Args): void {
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

    public get(...args: Args): ResT {
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
export function getTypeDesc(typ: TypeNode): string {
    if (
        typ instanceof IntType ||
        typ instanceof StringType ||
        typ instanceof BytesType ||
        typ instanceof BoolType
    ) {
        return typ.pp();
    }

    if (typ instanceof AddressType) {
        return "address" + (typ.payable ? "_payable" : "");
    }

    if (typ instanceof ArrayType) {
        return `${getTypeDesc(typ.elementT)}_arr` + (typ.size !== undefined ? `_${typ.size}` : "");
    }

    if (typ instanceof UserDefinedType) {
        return `${typ.name.replace(".", "_")}_${typ.definition.id}`;
    }

    if (typ instanceof MappingType) {
        return `mapping_${getTypeDesc(typ.keyType)}_to_${getTypeDesc(typ.valueType)}`;
    }

    if (typ instanceof PointerType) {
        return getTypeDesc(typ.to);
    }

    throw new Error(`Unknown type ${typ.pp()} in getTypeDesc`);
}

export function mkLibraryFunRef(
    ctx: InstrumentationContext,
    fn: FunctionDefinition
): MemberAccess | Identifier {
    const factory = ctx.factory;
    let ref: MemberAccess | Identifier;
    if (fn.visibility === FunctionVisibility.Private) {
        ref = factory.makeIdentifierFor(fn);
    } else {
        ref = factory.makeMemberAccess(
            "<missing>",
            factory.makeIdentifierFor(fn.vScope as ContractDefinition),
            fn.name,
            fn.id
        );
    }
    ctx.addGeneralInstrumentation(ref);
    return ref;
}
