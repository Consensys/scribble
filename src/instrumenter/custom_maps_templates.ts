import { gte, lt } from "semver";
import {
    ArrayType,
    assert,
    Block,
    ContractDefinition,
    ContractKind,
    DataLocation,
    Expression,
    FunctionCallKind,
    FunctionDefinition,
    FunctionStateMutability,
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
    StructDefinition,
    TypeName,
    TypeNode,
    UncheckedBlock,
    UserDefinedType,
    VariableDeclaration,
    VariableDeclarationStatement
} from "solc-typed-ast";
import { single } from "../util/misc";
import { InstrumentationContext } from "./instrumentation_context";
import { transpileType } from "./transpile";
import { getTypeDesc, getTypeLocation, needsLocation, ScribbleFactory } from "./utils";

function makeStruct(
    factory: ScribbleFactory,
    keyT: TypeNode,
    valueT: TypeNode,
    lib: ContractDefinition
): StructDefinition {
    const struct = factory.makeStructDefinition("S", lib.id, "", []);

    factory.addStructField("innerM", new MappingType(keyT, valueT), struct);
    factory.addStructField("keys", new ArrayType(keyT), struct);
    factory.addStructField("keyIdxM", new MappingType(keyT, new IntType(256, false)), struct);

    if (valueT instanceof IntType) {
        factory.addStructField("sum", new IntType(256, valueT.signed), struct);
    }

    return struct;
}

function mkInnerM(
    factory: ScribbleFactory,
    base: Expression,
    struct: StructDefinition
): MemberAccess {
    return factory.mkStructFieldAcc(base, struct, 0);
}

function mkVarDecl(
    factory: ScribbleFactory,
    name: string,
    typ: TypeName,
    location: DataLocation,
    initialVal: Expression | undefined,
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

    const stmt = factory.makeVariableDeclarationStatement(
        initialVal ? [decl.id] : [],
        [decl],
        initialVal
    );

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

    const fn = factory.addEmptyFun(ctx, name, FunctionVisibility.Internal, lib);

    const m = factory.addFunArg(
        "m",
        new UserDefinedType(struct.name, struct),
        DataLocation.Storage,
        fn
    );

    const key = factory.addFunArg(
        "key",
        keyT,
        needsLocation(keyT) ? DataLocation.Memory : DataLocation.Default,
        fn
    );

    const ret = factory.addFunRet(
        ctx,
        "RET",
        valueT,
        needsLocation(valueT) ? DataLocation.Storage : DataLocation.Default,
        fn
    );

    let body: Block | UncheckedBlock;

    if (unchecked) {
        body = factory.addStmt(fn, factory.makeUncheckedBlock([])) as UncheckedBlock;
    } else {
        body = fn.vBody as Block;
    }

    const mkInnerM = () => factory.mkStructFieldAcc(factory.makeIdentifierFor(m), struct, 0);

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
        factory.addStmt(body, factory.makeReturn(fn.vReturnParameters.id, update));
    } else {
        factory.addStmt(
            body,
            factory.makeAssignment(
                "<missing>",
                "=",
                factory.makeIdentifierFor(ret),
                factory.makeIndexAccess("<missing>", mkInnerM(), factory.makeIdentifierFor(key))
            )
        );

        factory.addStmt(body, update);
    }

    return fn;
}

function makeRemoveKeyFun(
    ctx: InstrumentationContext,
    keyT: TypeNode,
    struct: StructDefinition,
    lib: ContractDefinition
): FunctionDefinition {
    const factory = ctx.factory;
    const fn = factory.addEmptyFun(ctx, "removeKey", FunctionVisibility.Private, lib);

    const m = factory.addFunArg(
        "m",
        new UserDefinedType(struct.name, struct),
        DataLocation.Storage,
        fn
    );

    const key = factory.addFunArg("key", keyT, getTypeLocation(keyT, DataLocation.Memory), fn);

    const mkKeys = () => factory.mkStructFieldAcc(factory.makeIdentifierFor(m), struct, 1);
    const mkKeysLen = () => factory.makeMemberAccess("<missing>", mkKeys(), "length", -1);
    const mkKeyIdxM = () => factory.mkStructFieldAcc(factory.makeIdentifierFor(m), struct, 2);
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
        fn
    );

    factory.addStmt(fn, declStmt);

    // if (idx == 0) {
    //     return;
    // }
    factory.addStmt(
        fn,
        factory.makeIfStatement(
            factory.makeBinaryOperation(
                "<missing>",
                "==",
                factory.makeIdentifierFor(idx),
                factory.makeLiteral("<missing>", LiteralKind.Number, "", "0")
            ),
            factory.makeReturn(fn.vReturnParameters.id)
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
        getTypeLocation(keyT, DataLocation.Storage),
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
        fn
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
    factory.addStmt(fn, factory.makeIfStatement(cond, factory.makeBlock(ifBody)));

    // m.keys.pop();
    if (lt(ctx.compilerVersion, "0.5.0")) {
        factory.addStmt(
            fn,
            mkDelete(
                factory.makeIndexAccess(
                    "<mising>",
                    mkKeys(),
                    factory.makeBinaryOperation(
                        "uint256",
                        "-",
                        mkKeysLen(),
                        factory.makeLiteral("<missing>", LiteralKind.Number, "", "1")
                    )
                )
            )
        );
        factory.addStmt(fn, factory.makeUnaryOperation("uint256", false, "--", mkKeysLen()));
    } else {
        factory.addStmt(
            fn,
            factory.makeFunctionCall("<missing>", FunctionCallKind.FunctionCall, mkKeysPop(), [])
        );
    }

    // delete m.keyIdxM[key];
    factory.addStmt(
        fn,
        mkDelete(factory.makeIndexAccess("<mising>", mkKeyIdxM(), factory.makeIdentifierFor(key)))
    );

    return fn;
}

function makeAddKeyFun(
    ctx: InstrumentationContext,
    keyT: TypeNode,
    struct: StructDefinition,
    lib: ContractDefinition
): FunctionDefinition {
    const factory = ctx.factory;
    const fn = factory.addEmptyFun(ctx, "addKey", FunctionVisibility.Private, lib);

    const m = factory.addFunArg(
        "m",
        new UserDefinedType(struct.name, struct),
        DataLocation.Storage,
        fn
    );

    const key = factory.addFunArg("key", keyT, getTypeLocation(keyT, DataLocation.Memory), fn);

    const mkKeys = () => factory.mkStructFieldAcc(factory.makeIdentifierFor(m), struct, 1);
    const mkKeysLen = () => factory.makeMemberAccess("<missing>", mkKeys(), "length", -1);
    const mkKeysPush = () => factory.makeMemberAccess("<missing>", mkKeys(), "push", -1);
    const mkKeyIdxM = () => factory.mkStructFieldAcc(factory.makeIdentifierFor(m), struct, 2);

    // uint idx = m.keyIdxM[key];
    const [idx, idxStmt] = mkVarDecl(
        factory,
        "idx",
        factory.makeElementaryTypeName("<missing>", "uint"),
        DataLocation.Default,
        factory.makeIndexAccess("<missing>", mkKeyIdxM(), factory.makeIdentifierFor(key)),
        fn
    );

    factory.addStmt(fn, idxStmt);

    // if (idx == 0) {
    const ifNoIdxStmt = factory.addStmt(
        fn,
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
    const ifFirstKeyStmt = factory.addStmt(
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

    //         m.keys.push(); <or> m.keys.length++
    const pushStmt = lt(ctx.compilerVersion, "0.6.0")
        ? factory.makeUnaryOperation("uint256", false, "++", mkKeysLen())
        : factory.makeFunctionCall("<missing>", FunctionCallKind.FunctionCall, mkKeysPush(), []);

    factory.addStmt(ifFirstKeyStmt.vTrueBody as Block, pushStmt);

    //     }
    //     m.keyIdxM[key] = m.keys.length;
    factory.addStmt(
        ifNoIdxStmt.vTrueBody as Block,
        factory.makeAssignment(
            "<missing>",
            "=",
            factory.makeIndexAccess("<missing>", mkKeyIdxM(), factory.makeIdentifierFor(key)),
            mkKeysLen()
        )
    );

    //     m.keys.push(key);
    factory.addStmt(
        ifNoIdxStmt.vTrueBody as Block,
        factory.makeFunctionCall("<missing>", FunctionCallKind.FunctionCall, mkKeysPush(), [
            factory.makeIdentifierFor(key)
        ])
    );
    // }

    return fn;
}

export function makeGetFun(
    ctx: InstrumentationContext,
    keyT: TypeNode,
    valueT: TypeNode,
    lib: ContractDefinition,
    lhs: boolean
): FunctionDefinition {
    const factory = ctx.factory;
    const fn = factory.addEmptyFun(ctx, lhs ? "get_lhs" : "get", FunctionVisibility.Internal, lib);

    fn.stateMutability = lhs ? FunctionStateMutability.NonPayable : FunctionStateMutability.View;

    const struct = single(lib.vStructs);

    const m = factory.addFunArg(
        "m",
        new UserDefinedType(struct.name, struct),
        DataLocation.Storage,
        fn
    );

    const key = factory.addFunArg("key", keyT, getTypeLocation(keyT, DataLocation.Memory), fn);

    factory.addFunRet(ctx, "", valueT, getTypeLocation(valueT, DataLocation.Storage), fn);

    // When indexes appear on the LHS of assignments we need to update the keys array as well
    if (lhs) {
        const addKey = single(lib.vFunctions.filter((fun) => fun.name === "addKey"));

        factory.addStmt(
            fn,
            factory.makeFunctionCall(
                "<missing>",
                FunctionCallKind.FunctionCall,
                factory.mkLibraryFunRef(ctx, addKey),
                [factory.makeIdentifierFor(m), factory.makeIdentifierFor(key)]
            )
        );
    }

    // return m.innerM[key];
    factory.addStmt(
        fn,
        factory.makeReturn(
            fn.vReturnParameters.id,
            factory.makeIndexAccess(
                "<missing>",
                mkInnerM(factory, factory.makeIdentifierFor(m), struct),
                factory.makeIdentifierFor(key)
            )
        )
    );

    return fn;
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

    const fn = factory.addEmptyFun(ctx, name, FunctionVisibility.Internal, lib);

    ctx.addGeneralInstrumentation(fn.vBody as Block);

    const m = factory.addFunArg(
        "m",
        new UserDefinedType(struct.name, struct),
        DataLocation.Storage,
        fn
    );

    const key = factory.addFunArg("key", keyT, getTypeLocation(keyT, DataLocation.Memory), fn);
    const val = factory.addFunArg(
        "val",
        specializedValueT,
        getTypeLocation(specializedValueT, DataLocation.Memory),
        fn
    );

    factory.addFunRet(ctx, "", valueT, getTypeLocation(valueT, DataLocation.Storage), fn);

    const mkInnerM = () => factory.mkStructFieldAcc(factory.makeIdentifierFor(m), struct, 0);
    const mkSum = () => factory.mkStructFieldAcc(factory.makeIdentifierFor(m), struct, 3);

    if (valueT instanceof IntType) {
        // TODO: There is risk of overflow/underflow here
        const incStmts = [
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
        ];

        if (gte(ctx.compilerVersion, "0.8.0")) {
            const block = factory.makeUncheckedBlock(incStmts);

            factory.addStmt(fn, block);
        } else {
            incStmts.forEach((stmt) => factory.addStmt(fn, stmt));
        }
    }

    //m.innerM[key] = val;
    factory.addStmt(
        fn,
        factory.makeAssignment(
            "<missing>",
            "=",
            factory.makeIndexAccess("<missing>", mkInnerM(), factory.makeIdentifierFor(key)),
            factory.makeIdentifierFor(val)
        )
    );

    // addKey(m, key);
    const addKey = single(lib.vFunctions.filter((fun) => fun.name === "addKey"));

    factory.addStmt(
        fn,
        factory.makeFunctionCall(
            "<missing>",
            FunctionCallKind.FunctionCall,
            factory.mkLibraryFunRef(ctx, addKey),
            [factory.makeIdentifierFor(m), factory.makeIdentifierFor(key)]
        )
    );

    // return m.innerM[key];
    factory.addStmt(
        fn,
        factory.makeReturn(
            fn.vReturnParameters.id,
            factory.makeIndexAccess("<missing>", mkInnerM(), factory.makeIdentifierFor(key))
        )
    );

    return fn;
}

export function makeDeleteFun(
    ctx: InstrumentationContext,
    keyT: TypeNode,
    valueT: TypeNode,
    lib: ContractDefinition
): FunctionDefinition {
    const factory = ctx.factory;
    const struct = single(lib.vStructs);

    const fn = factory.addEmptyFun(ctx, "deleteKey", FunctionVisibility.Internal, lib);

    ctx.addGeneralInstrumentation(fn.vBody as Block);

    const m = factory.addFunArg(
        "m",
        new UserDefinedType(struct.name, struct),
        DataLocation.Storage,
        fn
    );

    const key = factory.addFunArg("key", keyT, getTypeLocation(keyT, DataLocation.Memory), fn);

    const mkInnerM = () => factory.mkStructFieldAcc(factory.makeIdentifierFor(m), struct, 0);
    const mkDelete = (exp: Expression) =>
        factory.makeExpressionStatement(
            factory.makeUnaryOperation("<missing>", true, "delete", exp)
        );
    const mkSum = () => factory.mkStructFieldAcc(factory.makeIdentifierFor(m), struct, 3);

    if (valueT instanceof IntType) {
        // m.sum -= m.innerM[key];
        factory.addStmt(
            fn,
            factory.makeAssignment(
                "<missing>",
                "-=",
                mkSum(),
                factory.makeIndexAccess("<missing>", mkInnerM(), factory.makeIdentifierFor(key))
            )
        );
    }

    // delete m.innerM[key];
    factory.addStmt(
        fn,
        mkDelete(factory.makeIndexAccess("<missing>", mkInnerM(), factory.makeIdentifierFor(key)))
    );

    const removeKey = single(lib.vFunctions.filter((fun) => fun.name === "removeKey"));

    factory.addStmt(
        fn,
        factory.makeFunctionCall(
            "<missing>",
            FunctionCallKind.FunctionCall,
            factory.mkLibraryFunRef(ctx, removeKey),
            [factory.makeIdentifierFor(m), factory.makeIdentifierFor(key)]
        )
    );

    return fn;
}

export function generateMapLibrary(
    ctx: InstrumentationContext,
    keyT: TypeNode,
    valueT: TypeNode,
    container: SourceUnit
): ContractDefinition {
    const factory = ctx.factory;
    const libName = `${getTypeDesc(keyT)}_to_${getTypeDesc(valueT)}_${container.id}`;

    const lib = factory.makeContractDefinition(
        libName,
        container.id,
        ContractKind.Library,
        false,
        true,
        [],
        [],
        []
    );

    lib.linearizedBaseContracts.push(lib.id);

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
        "Invalid new val type {0} in setter to {1}",
        newValT,
        formalT
    );

    return formalT.size !== newValT.to.size || formalT.elementT.pp() !== newValT.to.elementT.pp();
}

export function getSetterName(formalT: TypeNode, newValT: TypeNode): string {
    return `set${setterNeedsSpecialization(formalT, newValT) ? `_${getTypeDesc(newValT)}` : ""}`;
}
