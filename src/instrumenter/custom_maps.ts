import {
    AddressType,
    ArrayType,
    ASTNodeFactory,
    Block,
    BoolType,
    BytesType,
    ContractDefinition,
    ContractKind,
    DataLocation,
    Expression,
    FunctionCallKind,
    FunctionDefinition,
    FunctionKind,
    FunctionStateMutability,
    FunctionVisibility,
    getNodeType,
    IntType,
    LiteralKind,
    MappingType,
    MemberAccess,
    Mutability,
    SourceUnit,
    Statement,
    StateVariableVisibility,
    StringType,
    StructDefinition,
    TypeName,
    TypeNode,
    UserDefinedType,
    VariableDeclaration,
    VariableDeclarationStatement
} from "solc-typed-ast";
import { transpileType } from "..";

function getTypeDesc(typ: TypeNode): string {
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
        return `${typ.name}_${typ.definition.id}`;
    }

    throw new Error(`Unknown type ${typ.pp()} in getTypeDesc`);
}

function getLibraryName(keyT: TypeNode, valueT: TypeNode): string {
    return `${getTypeDesc(keyT)}_to_${getTypeDesc(valueT)}`;
}

function addStructField(
    factory: ASTNodeFactory,
    name: string,
    typ: TypeNode,
    struct: StructDefinition
): void {
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
}

function needsLocation(t: TypeNode): boolean {
    if (
        t instanceof ArrayType ||
        t instanceof StringType ||
        t instanceof BytesType ||
        t instanceof MappingType ||
        (t instanceof UserDefinedType && t.definition instanceof StructDefinition)
    ) {
        return true;
    }

    return false;
}

function addFunArg(
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

function addFunRet(
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

    fun.vReturnParameters.appendChild(arg);
    return arg;
}

function makeStruct(
    factory: ASTNodeFactory,
    keyT: TypeNode,
    valueT: TypeNode,
    lib: ContractDefinition
): StructDefinition {
    const struct = factory.makeStructDefinition("S", "S", lib.id, "", []);

    addStructField(factory, "innerM", new MappingType(keyT, valueT), struct);
    addStructField(factory, "keys", new ArrayType(keyT), struct);
    addStructField(factory, "keyIdxM", new MappingType(keyT, new IntType(256, false)), struct);

    return struct;
}

function addEmptyFun(
    factory: ASTNodeFactory,
    name: string,
    container: ContractDefinition | SourceUnit
): FunctionDefinition {
    const fun = factory.makeFunctionDefinition(
        container.id,
        FunctionKind.Function,
        name,
        false,
        FunctionVisibility.Public,
        FunctionStateMutability.NonPayable,
        false,
        factory.makeParameterList([]),
        factory.makeParameterList([]),
        [],
        undefined,
        factory.makeBlock([])
    );
    container.appendChild(fun);
    return fun;
}

function addStmt(
    factory: ASTNodeFactory,
    fun: FunctionDefinition,
    arg: Statement | Expression
): void {
    const body = fun.vBody as Block;
    body.appendChild(arg instanceof Statement ? arg : factory.makeExpressionStatement(arg));
}

function mkStructFieldAcc(
    factory: ASTNodeFactory,
    base: Expression,
    struct: StructDefinition,
    idx: number
): MemberAccess {
    const field = struct.vMembers[idx];
    return factory.makeMemberAccess("<missing>", base, field.name, field.id);
}

function mkInnerM(
    factory: ASTNodeFactory,
    base: Expression,
    struct: StructDefinition
): MemberAccess {
    return mkStructFieldAcc(factory, base, struct, 0);
}

function mkVarDecl(
    factory: ASTNodeFactory,
    name: string,
    typ: TypeName,
    location: DataLocation,
    val: Expression,
    fun: FunctionDefinition
): [VariableDeclaration, VariableDeclarationStatement] {
    const decl = factory.makeVariableDeclaration(
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
        typ
    );

    const stmt = factory.makeVariableDeclarationStatement([decl.id], [decl], val);

    return [decl, stmt];
}

function makeGetFun(
    factory: ASTNodeFactory,
    keyT: TypeNode,
    valueT: TypeNode,
    struct: StructDefinition,
    lib: ContractDefinition
): FunctionDefinition {
    const fun = addEmptyFun(factory, "get", lib);

    const m = addFunArg(
        factory,
        "m",
        new UserDefinedType(struct.name, struct),
        DataLocation.Storage,
        fun
    );
    const key = addFunArg(
        factory,
        "key",
        keyT,
        needsLocation(keyT) ? DataLocation.Memory : DataLocation.Default,
        fun
    );
    addFunRet(
        factory,
        "",
        valueT,
        needsLocation(valueT) ? DataLocation.Storage : DataLocation.Default,
        fun
    );

    // return m.innerM[key];
    addStmt(
        factory,
        fun,
        factory.makeReturn(
            fun.vReturnParameters.id,
            factory.makeIndexAccess(
                "<missing>",
                mkInnerM(factory, factory.makeIdentifierFor(m), struct),
                factory.makeIdentifierFor(key)
            )
        )
    );

    return fun;
}

function makeSetFun(
    factory: ASTNodeFactory,
    keyT: TypeNode,
    valueT: TypeNode,
    struct: StructDefinition,
    lib: ContractDefinition
): FunctionDefinition {
    const fun = addEmptyFun(factory, "set", lib);

    const m = addFunArg(
        factory,
        "m",
        new UserDefinedType(struct.name, struct),
        DataLocation.Storage,
        fun
    );
    const key = addFunArg(
        factory,
        "key",
        keyT,
        needsLocation(keyT) ? DataLocation.Memory : DataLocation.Default,
        fun
    );
    const val = addFunArg(
        factory,
        "val",
        valueT,
        needsLocation(valueT) ? DataLocation.Memory : DataLocation.Default,
        fun
    );

    const mkInnerM = () => mkStructFieldAcc(factory, factory.makeIdentifierFor(m), struct, 0);
    const mkKeys = () => mkStructFieldAcc(factory, factory.makeIdentifierFor(m), struct, 1);
    const mkKeysLen = () => factory.makeMemberAccess("<missing>", mkKeys(), "length", -1);
    const mkKeysPush = () => factory.makeMemberAccess("<missing>", mkKeys(), "push", -1);
    const mkKeyIdxM = () => mkStructFieldAcc(factory, factory.makeIdentifierFor(m), struct, 2);

    //m.innerM[key] = val;
    addStmt(
        factory,
        fun,
        factory.makeAssignment(
            "<missing>",
            "=",
            factory.makeIndexAccess("<missing>", mkInnerM(), factory.makeIdentifierFor(key)),
            factory.makeIdentifierFor(val)
        )
    );

    //uint idx = m.keyIdxM[key];
    const idx = factory.makeVariableDeclaration(
        false,
        false,
        "idx",
        fun.id,
        false,
        DataLocation.Default,
        StateVariableVisibility.Default,
        Mutability.Mutable,
        "<missing>",
        undefined,
        factory.makeElementaryTypeName("<missing>", "uint256")
    );

    addStmt(
        factory,
        fun,
        factory.makeVariableDeclarationStatement(
            [idx.id],
            [idx],
            factory.makeIndexAccess("<missing>", mkKeyIdxM(), factory.makeIdentifierFor(key))
        )
    );

    //if (idx > 0) {
    //    return;
    //}
    addStmt(
        factory,
        fun,
        factory.makeIfStatement(
            factory.makeBinaryOperation(
                "<missing>",
                ">",
                factory.makeIdentifierFor(idx),
                factory.makeLiteral("<missing>", LiteralKind.Number, "", "0")
            ),
            factory.makeReturn(fun.vReturnParameters.id)
        )
    );

    //if (m.keys.length == 0) {
    //    m.keys.push();
    //}
    addStmt(
        factory,
        fun,
        factory.makeIfStatement(
            factory.makeBinaryOperation(
                "<missing>",
                "==",
                mkKeysLen(),
                factory.makeLiteral("<missing>", LiteralKind.Number, "", "0")
            ),
            factory.makeBlock([
                factory.makeExpressionStatement(
                    factory.makeFunctionCall(
                        "<missing>",
                        FunctionCallKind.FunctionCall,
                        mkKeysPush(),
                        []
                    )
                )
            ])
        )
    );

    //m.keyIdxM[key] = m.keys.length;
    addStmt(
        factory,
        fun,
        factory.makeAssignment(
            "<missing>",
            "=",
            factory.makeIndexAccess("<missing>", mkKeyIdxM(), factory.makeIdentifierFor(key)),
            mkKeysLen()
        )
    );
    //m.keys.push(key);
    addStmt(
        factory,
        fun,
        factory.makeExpressionStatement(
            factory.makeFunctionCall("<missing>", FunctionCallKind.FunctionCall, mkKeysPush(), [
                factory.makeIdentifierFor(key)
            ])
        )
    );

    return fun;
}

function makeDeleteFun(
    factory: ASTNodeFactory,
    keyT: TypeNode,
    valueT: TypeNode,
    struct: StructDefinition,
    lib: ContractDefinition
): FunctionDefinition {
    const fun = addEmptyFun(factory, "deleteKey", lib);

    const m = addFunArg(
        factory,
        "m",
        new UserDefinedType(struct.name, struct),
        DataLocation.Storage,
        fun
    );
    const key = addFunArg(
        factory,
        "key",
        keyT,
        needsLocation(keyT) ? DataLocation.Memory : DataLocation.Default,
        fun
    );

    const mkInnerM = () => mkStructFieldAcc(factory, factory.makeIdentifierFor(m), struct, 0);
    const mkKeys = () => mkStructFieldAcc(factory, factory.makeIdentifierFor(m), struct, 1);
    const mkKeysLen = () => factory.makeMemberAccess("<missing>", mkKeys(), "length", -1);
    const mkKeysPop = () => factory.makeMemberAccess("<missing>", mkKeys(), "pop", -1);
    const mkKeyIdxM = () => mkStructFieldAcc(factory, factory.makeIdentifierFor(m), struct, 2);
    const mkDelete = (exp: Expression) =>
        factory.makeExpressionStatement(
            factory.makeUnaryOperation("<missing>", true, "delete", exp)
        );

    // delete m.innerM[key];
    addStmt(
        factory,
        fun,
        mkDelete(factory.makeIndexAccess("<missing>", mkInnerM(), factory.makeIdentifierFor(key)))
    );

    // uint idx = m.keyIdxM[key];
    const [idx, declStmt] = mkVarDecl(
        factory,
        "idx",
        factory.makeElementaryTypeName("<missing>", "uint256"),
        DataLocation.Default,
        factory.makeIndexAccess("<missing>", mkKeyIdxM(), factory.makeIdentifierFor(key)),
        fun
    );
    addStmt(factory, fun, declStmt);

    // if (idx == 0) {
    //     return;
    // }
    addStmt(
        factory,
        fun,
        factory.makeIfStatement(
            factory.makeBinaryOperation(
                "<missing>",
                "==",
                factory.makeIdentifierFor(idx),
                factory.makeLiteral("<missing>", LiteralKind.Number, "", "0")
            ),
            factory.makeReturn(fun.vReturnParameters.id)
        )
    );

    // if (idx != m.keys.length - 1) {
    const cond = factory.makeBinaryOperation(
        "<missing>",
        "!=",
        factory.makeIdentifierFor(idx),
        factory.makeBinaryOperation(
            "<missing>",
            "-",
            mkKeysLen(),
            factory.makeLiteral("<missing>", LiteralKind.Number, "", "1")
        )
    );

    const ifBody: Statement[] = [];
    //     uint lastKey = m.keys[m.keys.length - 1];
    const [lastKey, lastKeyDecl] = mkVarDecl(
        factory,
        "lastKey",
        transpileType(keyT, factory),
        needsLocation(keyT) ? DataLocation.Storage : DataLocation.Default,
        factory.makeIndexAccess(
            "<missing>",
            mkKeys(),
            factory.makeBinaryOperation(
                "<missing>",
                "-",
                mkKeysLen(),
                factory.makeLiteral("<missing>", LiteralKind.Number, "", "1")
            )
        ),
        fun
    );
    ifBody.push(lastKeyDecl);

    //     m.keys[idx] = lastKey;
    ifBody.push(
        factory.makeExpressionStatement(
            factory.makeAssignment(
                "<missing>",
                "=",
                factory.makeIndexAccess("<missing>", mkKeys(), factory.makeIdentifierFor(idx)),
                factory.makeIdentifierFor(lastKey)
            )
        )
    );

    //     m.keyIdxM[lastKey] = idx;
    ifBody.push(
        factory.makeExpressionStatement(
            factory.makeAssignment(
                "<missing>",
                "=",
                factory.makeIndexAccess(
                    "<missing>",
                    mkKeyIdxM(),
                    factory.makeIdentifierFor(lastKey)
                ),
                factory.makeIdentifierFor(idx)
            )
        )
    );

    // }
    addStmt(factory, fun, factory.makeIfStatement(cond, factory.makeBlock(ifBody)));

    // m.keys.pop();
    addStmt(
        factory,
        fun,
        factory.makeFunctionCall("<missing>", FunctionCallKind.FunctionCall, mkKeysPop(), [])
    );
    // delete m.keyIdxM[key];
    addStmt(
        factory,
        fun,
        mkDelete(factory.makeIndexAccess("<mising>", mkKeyIdxM(), factory.makeIdentifierFor(key)))
    );

    return fun;
}

function typeContainsMap(t: TypeNode, compilerVersion: string): boolean {
    if (t instanceof MappingType) {
        return true;
    }

    if (t instanceof ArrayType) {
        return typeContainsMap(t.elementT, compilerVersion);
    }

    if (t instanceof UserDefinedType && t.definition instanceof StructDefinition) {
        for (const field of t.definition.vMembers) {
            const fieldT = getNodeType(field, compilerVersion);
            if (typeContainsMap(fieldT, compilerVersion)) {
                return true;
            }
        }
    }

    return false;
}

export function generateMapLibrary(
    factory: ASTNodeFactory,
    keyT: TypeNode,
    valueT: TypeNode,
    container: SourceUnit,
    compilerVersion: string
): ContractDefinition {
    const libName = getLibraryName(keyT, valueT);

    const lib = factory.makeContractDefinition(
        libName,
        container.id,
        ContractKind.Library,
        false,
        true,
        [],
        []
    );

    const struct = makeStruct(factory, keyT, valueT, lib);
    lib.appendChild(struct);
    makeGetFun(factory, keyT, valueT, struct, lib);

    // For value types containing maps its not possible to re-assign or delete indices
    if (!typeContainsMap(valueT, compilerVersion)) {
        makeSetFun(factory, keyT, valueT, struct, lib);
        makeDeleteFun(factory, keyT, valueT, struct, lib);
    }

    return lib;
}
