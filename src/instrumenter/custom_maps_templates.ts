import {
    AddressType,
    ArrayType,
    assert,
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
    Identifier,
    IfStatement,
    IntType,
    LiteralKind,
    MappingType,
    MemberAccess,
    Mutability,
    PointerType,
    SourceUnit,
    Statement,
    StateVariableVisibility,
    StringType,
    StructDefinition,
    TypeName,
    TypeNode,
    UserDefinedType,
    VariableDeclaration,
    VariableDeclarationStatement,
    variableDeclarationToTypeNode
} from "solc-typed-ast";
import { single, transpileType } from "..";
import { InstrumentationContext } from "./instrumentation_context";

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

export function getCustomMapLibraryName(keyT: TypeNode, valueT: TypeNode): string {
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

export function needsLocation(t: TypeNode): boolean {
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
    arg: Statement | Expression
): Statement {
    const body = loc instanceof FunctionDefinition ? (loc.vBody as Block) : loc;
    const stmt = arg instanceof Statement ? arg : factory.makeExpressionStatement(arg);
    body.appendChild(stmt);
    return stmt;
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

function makeIncDecFun(
    ctx: InstrumentationContext,
    keyT: TypeNode,
    valueT: TypeNode,
    struct: StructDefinition,
    lib: ContractDefinition,
    operator: "++" | "--",
    prefix: boolean
): FunctionDefinition {
    const factory = ctx.factory;
    const name = (operator == "++" ? "inc" : "dec") + (prefix ? "_pre" : "");
    const fun = addEmptyFun(ctx, name, FunctionVisibility.Internal, lib);

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

    const RET = addFunRet(
        ctx,
        "RET",
        valueT,
        needsLocation(valueT) ? DataLocation.Storage : DataLocation.Default,
        fun
    );

    const mkInnerM = () => mkStructFieldAcc(factory, factory.makeIdentifierFor(m), struct, 0);
    const curVal = factory.makeIndexAccess("<missing>", mkInnerM(), factory.makeIdentifierFor(key));
    const newVal = factory.makeBinaryOperation(
        "<missing>",
        operator[0],
        curVal,
        factory.makeLiteral("<missing>", LiteralKind.Number, "", "1")
    );
    const setter = single(lib.vFunctions.filter((f) => f.name == "set"));

    const update = factory.makeFunctionCall(
        "<missing>",
        FunctionCallKind.FunctionCall,
        factory.makeIdentifierFor(setter),
        [factory.makeIdentifierFor(m), factory.makeIdentifierFor(key), newVal]
    );

    if (prefix) {
        addStmt(factory, fun, factory.makeReturn(fun.vReturnParameters.id, update));
    } else {
        addStmt(
            factory,
            fun,
            factory.makeAssignment(
                "<missing>",
                "=",
                factory.makeIdentifierFor(RET),
                factory.makeIndexAccess("<missing>", mkInnerM(), factory.makeIdentifierFor(key))
            )
        );
        addStmt(factory, fun, update);
    }

    return fun;
}

function getLoc(t: TypeNode, defLoc: DataLocation): DataLocation {
    if (t instanceof PointerType) {
        return t.location;
    }

    return needsLocation(t) ? defLoc : DataLocation.Default;
}

function addLocalVar(
    factory: ASTNodeFactory,
    name: string,
    type: TypeName,
    loc: DataLocation,
    fn: FunctionDefinition,
    block: Block,
    initialVal?: Expression
): VariableDeclaration {
    const decl = factory.makeVariableDeclaration(
        false,
        false,
        name,
        fn.id,
        false,
        loc,
        StateVariableVisibility.Default,
        Mutability.Mutable,
        "<missing>",
        undefined,
        type
    );
    addStmt(
        factory,
        fn,
        factory.makeVariableDeclarationStatement(initialVal ? [decl.id] : [], [decl], initialVal)
    );

    return decl;
}

function makeRemoveKeyFun(
    ctx: InstrumentationContext,
    keyT: TypeNode,
    struct: StructDefinition,
    lib: ContractDefinition
): FunctionDefinition {
    const factory = ctx.factory;
    const fun = addEmptyFun(ctx, "removeKey", FunctionVisibility.Private, lib);

    const m = addFunArg(
        factory,
        "m",
        new UserDefinedType(struct.name, struct),
        DataLocation.Storage,
        fun
    );
    const key = addFunArg(factory, "key", keyT, getLoc(keyT, DataLocation.Memory), fun);

    const mkKeys = () => mkStructFieldAcc(factory, factory.makeIdentifierFor(m), struct, 1);
    const mkKeysLen = () => factory.makeMemberAccess("<missing>", mkKeys(), "length", -1);
    const mkKeyIdxM = () => mkStructFieldAcc(factory, factory.makeIdentifierFor(m), struct, 2);
    const mkDelete = (exp: Expression) =>
        factory.makeExpressionStatement(
            factory.makeUnaryOperation("<missing>", true, "delete", exp)
        );
    const mkKeysPop = () => factory.makeMemberAccess("<missing>", mkKeys(), "pop", -1);

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
        getLoc(keyT, DataLocation.Storage),
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

function makeAddKeyFun(
    ctx: InstrumentationContext,
    keyT: TypeNode,
    struct: StructDefinition,
    lib: ContractDefinition
): FunctionDefinition {
    const factory = ctx.factory;
    const fun = addEmptyFun(ctx, "addKey", FunctionVisibility.Private, lib);

    const m = addFunArg(
        factory,
        "m",
        new UserDefinedType(struct.name, struct),
        DataLocation.Storage,
        fun
    );
    const key = addFunArg(factory, "key", keyT, getLoc(keyT, DataLocation.Memory), fun);

    const mkKeys = () => mkStructFieldAcc(factory, factory.makeIdentifierFor(m), struct, 1);
    const mkKeysLen = () => factory.makeMemberAccess("<missing>", mkKeys(), "length", -1);
    const mkKeysPush = () => factory.makeMemberAccess("<missing>", mkKeys(), "push", -1);
    const mkKeyIdxM = () => mkStructFieldAcc(factory, factory.makeIdentifierFor(m), struct, 2);

    // uint idx = m.keyIdxM[key];
    const idx = addLocalVar(
        factory,
        "idx",
        factory.makeElementaryTypeName("<missing>", "uint"),
        DataLocation.Default,
        fun,
        fun.vBody as Block,
        factory.makeIndexAccess("<missing>", mkKeyIdxM(), factory.makeIdentifierFor(key))
    );
    // if (idx == 0) {
    const ifNoIdxStmt = addStmt(
        factory,
        fun,
        factory.makeIfStatement(
            factory.makeBinaryOperation(
                "<missing>",
                "==",
                factory.makeIdentifierFor(idx),
                factory.makeLiteral("<missing>", LiteralKind.Number, "", "0")
            ),
            factory.makeBlock([])
        )
    ) as IfStatement;
    //     if (m.keys.length == 0) {
    const ifFirstKeyStmt = addStmt(
        factory,
        ifNoIdxStmt.vTrueBody as Block,
        factory.makeIfStatement(
            factory.makeBinaryOperation(
                "<missing>",
                "==",
                mkKeysLen(),
                factory.makeLiteral("<missing>", LiteralKind.Number, "", "0")
            ),
            factory.makeBlock([])
        )
    ) as IfStatement;
    //         m.keys.push();
    addStmt(
        factory,
        ifFirstKeyStmt.vTrueBody as Block,
        factory.makeFunctionCall("<missing>", FunctionCallKind.FunctionCall, mkKeysPush(), [])
    );
    //     }
    //     m.keyIdxM[key] = m.keys.length;
    addStmt(
        factory,
        ifNoIdxStmt.vTrueBody as Block,
        factory.makeAssignment(
            "<missing>",
            "=",
            factory.makeIndexAccess("<missing>", mkKeyIdxM(), factory.makeIdentifierFor(key)),
            mkKeysLen()
        )
    );
    //     m.keys.push(key);
    addStmt(
        factory,
        ifNoIdxStmt.vTrueBody as Block,
        factory.makeFunctionCall("<missing>", FunctionCallKind.FunctionCall, mkKeysPush(), [
            factory.makeIdentifierFor(key)
        ])
    );
    // }

    return fun;
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

function makeGetFun(
    ctx: InstrumentationContext,
    keyT: TypeNode,
    valueT: TypeNode,
    struct: StructDefinition,
    lib: ContractDefinition,
    lhs: boolean
): FunctionDefinition {
    const factory = ctx.factory;
    const fun = addEmptyFun(ctx, lhs ? "get_lhs" : "get", FunctionVisibility.Internal, lib);

    const m = addFunArg(
        factory,
        "m",
        new UserDefinedType(struct.name, struct),
        DataLocation.Storage,
        fun
    );
    const key = addFunArg(factory, "key", keyT, getLoc(keyT, DataLocation.Memory), fun);

    addFunRet(ctx, "", valueT, getLoc(valueT, DataLocation.Storage), fun);

    // When indexes appear on the LHS of assignments we need to update the keys array as well
    if (lhs) {
        const addKey = single(lib.vFunctions.filter((fun) => fun.name === "addKey"));
        addStmt(
            factory,
            fun,
            factory.makeFunctionCall(
                "<missing>",
                FunctionCallKind.FunctionCall,
                mkLibraryFunRef(ctx, addKey),
                [factory.makeIdentifierFor(m), factory.makeIdentifierFor(key)]
            )
        );
    }

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
    ctx: InstrumentationContext,
    keyT: TypeNode,
    valueT: TypeNode,
    struct: StructDefinition,
    lib: ContractDefinition
): FunctionDefinition {
    const factory = ctx.factory;
    const fun = addEmptyFun(ctx, "set", FunctionVisibility.Internal, lib);
    ctx.addGeneralInstrumentation(fun.vBody as Block);

    const m = addFunArg(
        factory,
        "m",
        new UserDefinedType(struct.name, struct),
        DataLocation.Storage,
        fun
    );
    const key = addFunArg(factory, "key", keyT, getLoc(keyT, DataLocation.Memory), fun);
    const val = addFunArg(factory, "val", valueT, getLoc(valueT, DataLocation.Memory), fun);

    addFunRet(ctx, "", valueT, getLoc(valueT, DataLocation.Storage), fun);

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
            factory.makeReturn(
                fun.vReturnParameters.id,
                factory.makeIndexAccess("<missing>", mkInnerM(), factory.makeIdentifierFor(key))
            )
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

    // return m.innerM[key];
    addStmt(
        factory,
        fun,
        factory.makeReturn(
            fun.vReturnParameters.id,
            factory.makeIndexAccess("<missing>", mkInnerM(), factory.makeIdentifierFor(key))
        )
    );

    return fun;
}

function makeDeleteFun(
    ctx: InstrumentationContext,
    keyT: TypeNode,
    valueT: TypeNode,
    struct: StructDefinition,
    lib: ContractDefinition
): FunctionDefinition {
    const factory = ctx.factory;
    const fun = addEmptyFun(ctx, "deleteKey", FunctionVisibility.Internal, lib);
    ctx.addGeneralInstrumentation(fun.vBody as Block);

    const m = addFunArg(
        factory,
        "m",
        new UserDefinedType(struct.name, struct),
        DataLocation.Storage,
        fun
    );
    const key = addFunArg(factory, "key", keyT, getLoc(keyT, DataLocation.Memory), fun);

    const mkInnerM = () => mkStructFieldAcc(factory, factory.makeIdentifierFor(m), struct, 0);
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

    const removeKey = single(lib.vFunctions.filter((fun) => fun.name === "removeKey"));
    addStmt(
        factory,
        fun,
        factory.makeFunctionCall(
            "<missing>",
            FunctionCallKind.FunctionCall,
            mkLibraryFunRef(ctx, removeKey),
            [factory.makeIdentifierFor(m), factory.makeIdentifierFor(key)]
        )
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
            const fieldT = variableDeclarationToTypeNode(field);
            if (typeContainsMap(fieldT, compilerVersion)) {
                return true;
            }
        }
    }

    if (t instanceof PointerType) {
        return typeContainsMap(t.to, compilerVersion);
    }

    return false;
}

export function generateMapLibrary(
    ctx: InstrumentationContext,
    keyT: TypeNode,
    valueT: TypeNode,
    container: SourceUnit,
    compilerVersion: string
): ContractDefinition {
    const libName = getCustomMapLibraryName(keyT, valueT);
    const factory = ctx.factory;

    const lib = factory.makeContractDefinition(
        libName,
        container.id,
        ContractKind.Library,
        false,
        true,
        [],
        []
    );
    container.appendChild(lib);

    const struct = makeStruct(factory, keyT, valueT, lib);
    lib.appendChild(struct);

    makeAddKeyFun(ctx, keyT, struct, lib);
    makeRemoveKeyFun(ctx, keyT, struct, lib);
    makeGetFun(ctx, keyT, valueT, struct, lib, true);
    makeGetFun(ctx, keyT, valueT, struct, lib, false);

    // For value types containing maps its not possible to re-assign or delete indices
    if (!typeContainsMap(valueT, compilerVersion)) {
        makeSetFun(ctx, keyT, valueT, struct, lib);
        makeDeleteFun(ctx, keyT, valueT, struct, lib);
    }

    // For numeric types emit helpers for ++,--, {+,-,*,/,**,%,<<,>>}=
    if (valueT instanceof IntType) {
        makeIncDecFun(ctx, keyT, valueT, struct, lib, "++", true);
        makeIncDecFun(ctx, keyT, valueT, struct, lib, "++", false);
        makeIncDecFun(ctx, keyT, valueT, struct, lib, "--", true);
        makeIncDecFun(ctx, keyT, valueT, struct, lib, "--", false);
    }

    return lib;
}

function setterNeedsSpecialization(formalT: TypeNode, newValT: TypeNode): boolean {
    if (!(formalT instanceof ArrayType)) {
        return false;
    }

    assert(
        newValT instanceof PointerType && newValT.to instanceof ArrayType,
        `Invalid new val type ${newValT.pp()} in setter to ${formalT.pp()}`
    );

    return formalT.size !== newValT.to.size || formalT.elementT.pp() !== newValT.to.elementT.pp();
}

export function getSetterName(formalT: TypeNode, newValT: TypeNode): string {
    return `set${setterNeedsSpecialization(formalT, newValT) ? `_${getTypeDesc(newValT)}` : ""}`;
}

export function specializeSetter(
    factory: ASTNodeFactory,
    fn: FunctionDefinition,
    newValT: TypeNode
): FunctionDefinition {
    const specializedFn = factory.copy(fn);

    specializedFn.name += "_" + getTypeDesc(newValT);
    specializedFn.vParameters.vParameters[2].vType = transpileType(newValT, factory);

    return specializedFn;
}
