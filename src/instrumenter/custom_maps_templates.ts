import {
    ArrayType,
    assert,
    ASTNodeFactory,
    Block,
    BytesType,
    ContractDefinition,
    ContractKind,
    DataLocation,
    Expression,
    FunctionCallKind,
    FunctionDefinition,
    FunctionVisibility,
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
    UncheckedBlock,
    UserDefinedType,
    VariableDeclaration,
    VariableDeclarationStatement
} from "solc-typed-ast";
import {
    addEmptyFun,
    addFunArg,
    addFunRet,
    addStmt,
    addStructField,
    getTypeDesc,
    mkLibraryFunRef,
    mkStructFieldAcc,
    single,
    transpileType
} from "..";
import { InstrumentationContext } from "./instrumentation_context";

export function needsLocation(t: TypeNode): boolean {
    return (
        t instanceof ArrayType ||
        t instanceof StringType ||
        t instanceof BytesType ||
        t instanceof MappingType ||
        (t instanceof UserDefinedType && t.definition instanceof StructDefinition)
    );
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

    if (valueT instanceof IntType) {
        addStructField(factory, "sum", new IntType(256, valueT.signed), struct);
    }

    return struct;
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

export function makeIncDecFun(
    ctx: InstrumentationContext,
    keyT: TypeNode,
    valueT: TypeNode,
    lib: ContractDefinition,
    operator: "++" | "--",
    prefix: boolean,
    unchecked: boolean
): FunctionDefinition {
    const factory = ctx.factory;
    const struct = single(lib.vStructs);

    const name =
        (operator == "++" ? "inc" : "dec") + (prefix ? "_pre" : "") + (unchecked ? "_unch" : "");
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

    const ret = addFunRet(
        ctx,
        "RET",
        valueT,
        needsLocation(valueT) ? DataLocation.Storage : DataLocation.Default,
        fun
    );

    let body: Block | UncheckedBlock;
    if (unchecked) {
        body = addStmt(factory, fun, factory.makeUncheckedBlock([])) as UncheckedBlock;
    } else {
        body = fun.vBody as Block;
    }

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
        addStmt(factory, body, factory.makeReturn(fun.vReturnParameters.id, update));
    } else {
        addStmt(
            factory,
            body,
            factory.makeAssignment(
                "<missing>",
                "=",
                factory.makeIdentifierFor(ret),
                factory.makeIndexAccess("<missing>", mkInnerM(), factory.makeIdentifierFor(key))
            )
        );
        addStmt(factory, body, update);
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

export function makeGetFun(
    ctx: InstrumentationContext,
    keyT: TypeNode,
    valueT: TypeNode,
    lib: ContractDefinition,
    lhs: boolean
): FunctionDefinition {
    const factory = ctx.factory;
    const fun = addEmptyFun(ctx, lhs ? "get_lhs" : "get", FunctionVisibility.Internal, lib);
    const struct = single(lib.vStructs);

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

export function makeSetFun(
    ctx: InstrumentationContext,
    keyT: TypeNode,
    valueT: TypeNode,
    lib: ContractDefinition,
    newValT: TypeNode
): FunctionDefinition {
    const factory = ctx.factory;

    const specializedValueT = setterNeedsSpecialization(valueT, newValT) ? newValT : valueT;
    const name = getSetterName(valueT, newValT);
    const struct = single(lib.vStructs);

    const fun = addEmptyFun(ctx, name, FunctionVisibility.Internal, lib);
    ctx.addGeneralInstrumentation(fun.vBody as Block);

    const m = addFunArg(
        factory,
        "m",
        new UserDefinedType(struct.name, struct),
        DataLocation.Storage,
        fun
    );
    const key = addFunArg(factory, "key", keyT, getLoc(keyT, DataLocation.Memory), fun);
    const val = addFunArg(
        factory,
        "val",
        specializedValueT,
        getLoc(specializedValueT, DataLocation.Memory),
        fun
    );

    addFunRet(ctx, "", valueT, getLoc(valueT, DataLocation.Storage), fun);

    const mkInnerM = () => mkStructFieldAcc(factory, factory.makeIdentifierFor(m), struct, 0);
    const mkKeys = () => mkStructFieldAcc(factory, factory.makeIdentifierFor(m), struct, 1);
    const mkKeysLen = () => factory.makeMemberAccess("<missing>", mkKeys(), "length", -1);
    const mkKeysPush = () => factory.makeMemberAccess("<missing>", mkKeys(), "push", -1);
    const mkKeyIdxM = () => mkStructFieldAcc(factory, factory.makeIdentifierFor(m), struct, 2);
    const mkSum = () => mkStructFieldAcc(factory, factory.makeIdentifierFor(m), struct, 3);

    if (valueT instanceof IntType) {
        // TODO: There is risk of overflow/underflow here
        const block = factory.makeUncheckedBlock([
            // m.sum -= m.innerM[key];
            factory.makeExpressionStatement(
                factory.makeAssignment(
                    "<missing>",
                    "-=",
                    mkSum(),
                    factory.makeIndexAccess("<missing>", mkInnerM(), factory.makeIdentifierFor(key))
                )
            ),
            // m.sum += val;
            factory.makeExpressionStatement(
                factory.makeAssignment("<missing>", "+=", mkSum(), factory.makeIdentifierFor(val))
            )
        ]);
        addStmt(factory, fun, block);
    }

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
        factory.makeFunctionCall("<missing>", FunctionCallKind.FunctionCall, mkKeysPush(), [
            factory.makeIdentifierFor(key)
        ])
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

export function makeDeleteFun(
    ctx: InstrumentationContext,
    keyT: TypeNode,
    valueT: TypeNode,
    lib: ContractDefinition
): FunctionDefinition {
    const factory = ctx.factory;
    const struct = single(lib.vStructs);

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
    const mkSum = () => mkStructFieldAcc(factory, factory.makeIdentifierFor(m), struct, 3);

    if (valueT instanceof IntType) {
        // m.sum -= m.innerM[key];
        addStmt(
            factory,
            fun,
            factory.makeAssignment(
                "<missing>",
                "-=",
                mkSum(),
                factory.makeIndexAccess("<missing>", mkInnerM(), factory.makeIdentifierFor(key))
            )
        );
    }

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

export function generateMapLibrary(
    ctx: InstrumentationContext,
    keyT: TypeNode,
    valueT: TypeNode,
    container: SourceUnit
): ContractDefinition {
    const factory = ctx.factory;
    const libName = `${getTypeDesc(keyT)}_to_${getTypeDesc(valueT)}`;

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

    // All get,set,delete, inc and dec functions are generated on demand(see InstrumentationContext for details)
    return lib;
}

function setterNeedsSpecialization(formalT: TypeNode, newValT: TypeNode): newValT is PointerType {
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
