import {
    AddressType,
    ArrayType,
    ArrayTypeName,
    assert,
    Assignment,
    ASTNodeFactory,
    Block,
    BoolType,
    BytesType,
    ContractDefinition,
    ContractKind,
    DataLocation,
    eq,
    Expression,
    ExpressionStatement,
    FunctionCall,
    FunctionCallKind,
    FunctionDefinition,
    FunctionKind,
    FunctionStateMutability,
    FunctionVisibility,
    Identifier,
    IndexAccess,
    IntType,
    LiteralKind,
    Mapping,
    MappingType,
    MemberAccess,
    Mutability,
    PointerType,
    replaceNode,
    SourceUnit,
    Statement,
    StateVariableVisibility,
    StringType,
    StructDefinition,
    TypeName,
    typeNameToTypeNode,
    TypeNode,
    UnaryOperation,
    UserDefinedType,
    UserDefinedTypeName,
    VariableDeclaration,
    VariableDeclarationStatement,
    variableDeclarationToTypeNode
} from "solc-typed-ast";
import {
    ConcreteDatastructurePath,
    explodeTupleAssignment,
    findStateVarUpdates,
    single,
    transpileType
} from "..";
import { InstrumentationContext } from "./instrumentation_context";
import { InstrumentationSiteType } from "./transpiling_context";

export type StateVarRefDesc = [Expression, VariableDeclaration, ConcreteDatastructurePath];

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

function makeIncDecFun(
    factory: ASTNodeFactory,
    keyT: TypeNode,
    valueT: TypeNode,
    struct: StructDefinition,
    lib: ContractDefinition,
    operator: "++" | "--",
    prefix: boolean
): FunctionDefinition {
    const name = (operator == "++" ? "inc" : "dec") + (prefix ? "_pre" : "");
    const fun = addEmptyFun(factory, name, lib);

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
        factory,
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
    const key = addFunArg(factory, "key", keyT, getLoc(keyT, DataLocation.Memory), fun);
    addFunRet(factory, "", valueT, getLoc(valueT, DataLocation.Storage), fun);

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
    const key = addFunArg(factory, "key", keyT, getLoc(keyT, DataLocation.Memory), fun);
    const val = addFunArg(factory, "val", valueT, getLoc(valueT, DataLocation.Memory), fun);

    addFunRet(factory, "", valueT, getLoc(valueT, DataLocation.Storage), fun);

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
    const key = addFunArg(factory, "key", keyT, getLoc(keyT, DataLocation.Memory), fun);

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
    container.appendChild(lib);

    const struct = makeStruct(factory, keyT, valueT, lib);
    lib.appendChild(struct);
    makeGetFun(factory, keyT, valueT, struct, lib);

    // For value types containing maps its not possible to re-assign or delete indices
    if (!typeContainsMap(valueT, compilerVersion)) {
        makeSetFun(factory, keyT, valueT, struct, lib);
        makeDeleteFun(factory, keyT, valueT, struct, lib);
    }

    // For numeric types emit helpers for ++,--, {+,-,*,/,**,%,<<,>>}=
    if (valueT instanceof IntType) {
        makeIncDecFun(factory, keyT, valueT, struct, lib, "++", true);
        makeIncDecFun(factory, keyT, valueT, struct, lib, "++", false);
        makeIncDecFun(factory, keyT, valueT, struct, lib, "--", true);
        makeIncDecFun(factory, keyT, valueT, struct, lib, "--", false);
    }

    return lib;
}

type DatastructurePath = Array<null | string>;

/**
 * Given a TypeName `typ` and a `DatastructurePath` `path`, find the part of `typ` that corresponds to `path`.
 * `idx` is used internaly in the recursion to keep track of where we are in the path.
 *
 * @param typ
 * @param path
 * @param idx
 * @returns
 */
function lookupPathInType(typ: TypeName, path: DatastructurePath, idx = 0): TypeName {
    if (idx === path.length) {
        return typ;
    }

    const el = path[idx];

    if (el === null) {
        if (typ instanceof ArrayTypeName) {
            return lookupPathInType(typ.vBaseType, path, idx + 1);
        }

        if (typ instanceof Mapping) {
            return lookupPathInType(typ.vValueType, path, idx + 1);
        }

        // Handle case when the value type is a mapping that has already been
        // interposed.
        // @todo the check here is too loose
        if (
            typ instanceof UserDefinedTypeName &&
            typ.vReferencedDeclaration instanceof StructDefinition &&
            typ.vReferencedDeclaration.name === "S"
        ) {
            const valueT = single(
                typ.vReferencedDeclaration.vMembers.filter((field) => field.name === "innerM")
            ).vType;
            assert(valueT instanceof Mapping, ``);

            return lookupPathInType(valueT.vValueType, path, idx + 1);
        }
        throw new Error(`Unexpected type ${typ.constructor.name} for index path element`);
    }

    assert(
        typ instanceof UserDefinedTypeName &&
            typ.vReferencedDeclaration instanceof StructDefinition,
        `Expected user defined struct for path element ${el}`
    );

    const field = single(
        typ.vReferencedDeclaration.vMembers.filter((field) => field.name === el),
        `No field matching element path ${el} in struct ${typ.vReferencedDeclaration.name}`
    );

    assert(field.vType !== undefined, ``);

    return lookupPathInType(field.vType, path, idx + 1);
}

function pathMatch(a: DatastructurePath, b: ConcreteDatastructurePath): boolean {
    if (a.length + 1 !== b.length) {
        return false;
    }

    for (let i = 0; i < a.length; i++) {
        if (a[i] === null && b[i] instanceof Expression) {
            continue;
        }

        if (typeof a[i] === "string" && typeof b[i] === "string" && a[i] === b[i]) {
            continue;
        }

        return false;
    }

    assert(b[a.length] instanceof Expression, ``);
    return true;
}

function splitExpr(e: Expression): [Expression, Expression] {
    assert(e instanceof IndexAccess && e.vIndexExpression !== undefined, ``);
    return [e.vBaseExpression, e.vIndexExpression];
}

function getDeleteKey(factory: ASTNodeFactory, lib: ContractDefinition): Expression {
    const deleteKeyF = single(lib.vFunctions.filter((fun) => fun.name === "deleteKey"));
    return factory.makeMemberAccess(
        "<missing>",
        factory.makeIdentifierFor(lib),
        "deleteKey",
        deleteKeyF.id
    );
}

function getSetter(factory: ASTNodeFactory, lib: ContractDefinition): Expression {
    const setter = single(lib.vFunctions.filter((fun) => fun.name === "set"));
    return factory.makeMemberAccess("<missing>", factory.makeIdentifierFor(lib), "set", setter.id);
}

function getIncDecFun(
    factory: ASTNodeFactory,
    lib: ContractDefinition,
    operator: "++" | "--",
    prefix: boolean
): Expression {
    const name = (operator == "++" ? "inc" : "dec") + (prefix ? "_pre" : "");
    const setter = single(lib.vFunctions.filter((fun) => fun.name === name));
    return factory.makeMemberAccess("<missing>", factory.makeIdentifierFor(lib), name, setter.id);
}

function getGetter(factory: ASTNodeFactory, lib: ContractDefinition): Expression {
    const getter = single(lib.vFunctions.filter((fun) => fun.name === "get"));
    return factory.makeMemberAccess("<missing>", factory.makeIdentifierFor(lib), "get", getter.id);
}

function replaceAssignmentHelper(
    factory: ASTNodeFactory,
    assignment: Assignment,
    lib: ContractDefinition
): void {
    const newVal = assignment.vRightHandSide;
    const [base, index] = splitExpr(assignment.vLeftHandSide);

    const newNode = factory.makeFunctionCall(
        "<missing>",
        FunctionCallKind.FunctionCall,
        getSetter(factory, lib),
        [base, index, newVal]
    );

    replaceNode(assignment, newNode);
}

/**
 * Given a reference ot a state var `ref`, and a datasturcture path `path`, see if
 * `ref` is the base of an `IndexAccess` that accesses an index INSIDE the part of the state
 * var pointed to by `path`.
 * @param ref
 * @param path
 * @returns
 */
function getStateVarRefDesc(
    ref: Identifier | MemberAccess,
    path: DatastructurePath
): StateVarRefDesc | undefined {
    assert(
        ref.vReferencedDeclaration instanceof VariableDeclaration &&
            ref.vReferencedDeclaration.stateVariable,
        ""
    );

    const stateVar = ref.vReferencedDeclaration;
    const concretePath: ConcreteDatastructurePath = [];
    let expr: Expression = ref;

    for (let i = 0; i < path.length; i++) {
        const el = path[i];
        const pt = expr.parent;

        if (el === null) {
            if (!(pt instanceof IndexAccess && expr === pt.vBaseExpression)) {
                return undefined;
            }

            assert(pt.vIndexExpression !== undefined, ``);
            concretePath.push(pt.vIndexExpression);
        } else {
            if (!(pt instanceof MemberAccess && pt.memberName === el)) {
                return undefined;
            }
            concretePath.push(pt.memberName);
        }

        expr = pt;
    }

    if (!(expr.parent instanceof IndexAccess && expr === expr.parent.vBaseExpression)) {
        return undefined;
    }

    return [expr.parent, stateVar, concretePath];
}

export function findStateVarReferences(
    units: SourceUnit[],
    stateVar: VariableDeclaration,
    path: DatastructurePath
): StateVarRefDesc[] {
    const res: StateVarRefDesc[] = [];

    for (const unit of units) {
        for (const ref of unit.getChildrenBySelector<Identifier | MemberAccess>(
            (nd) =>
                (nd instanceof Identifier || nd instanceof MemberAccess) &&
                nd.vReferencedDeclaration instanceof VariableDeclaration &&
                nd.vReferencedDeclaration === stateVar
        )) {
            const refDesc = getStateVarRefDesc(ref, path);

            if (refDesc) {
                res.push(refDesc);
            }
        }
    }

    return res;
}

/**
 * Given a state variable `stateVar` and a DatastructurePath `path`, let `path`
 * reference the part `T` of `stateVar` (`T` is the whole variable when `path` is empty).
 *
 * If `T` is not a mapping an error is thrown. Otherwise:
 *
 * 0. Generate a custom library implementation `L` for the mapping type of `T`
 * 1. Replace the type of `T` in the `stateVar` declaration with `L.S`.
 * 2. Replace all var index updates with L.set(<base>, <key>, <newVal>) or L.deleteKey(<base>, <key>)
 * 3. Replace all index accesses `<base>[<key>]` on `T` with `L.get(<base>, <key>)`
 *
 * @param stateVar
 * @param path
 */
export function interposeMap(
    instrCtx: InstrumentationContext,
    targets: Array<[VariableDeclaration, DatastructurePath]>,
    mapContainer: SourceUnit,
    units: SourceUnit[]
): void {
    const allUpdates = findStateVarUpdates(units);

    targets.sort((a, b) => (a[1].length > b[1].length ? -1 : a[1].length == b[1].length ? 0 : 1));

    const mapTs = targets.map(([stateVar, path]) =>
        lookupPathInType(stateVar.vType as TypeName, path)
    );
    const factory = instrCtx.factory;
    const compilerVersion = instrCtx.compilerVersion;

    for (let i = 0; i < targets.length; i++) {
        const stateVar = targets[i][0];
        const path = targets[i][1];
        const mapT = mapTs[i];

        assert(
            mapT instanceof Mapping,
            `Referenced state var (part) must be mapping, not ${mapT.constructor.name}`
        );

        const keyT = typeNameToTypeNode(mapT.vKeyType);
        const valueT = typeNameToTypeNode(mapT.vValueType);

        // 0. Generate custom library implementation
        const lib = generateMapLibrary(factory, keyT, valueT, mapContainer, compilerVersion);
        const struct = single(lib.vStructs);

        // 1. Replace the type of `T` in the `stateVar` declaration with `L.S`
        const newMapT = factory.makeUserDefinedTypeName(
            "<missing>",
            `${lib.name}.${struct.name}`,
            struct.id
        );
        replaceNode(mapT, newMapT);

        // 2. Replace all var index updates with L.set(<base>, <key>, <newVal>) or L.deleteKey(<base>, <key>)
        const curVarUpdates = allUpdates.filter(([, v]) => v === stateVar);

        for (const [updateNode, , updPath] of curVarUpdates) {
            // Only interested in updates to the correct part of the state var
            if (!pathMatch(path, updPath)) {
                continue;
            }

            if (updateNode instanceof Array) {
                const [assignment, lhsPath] = updateNode;
                const containingFun = assignment.getClosestParentByType(
                    FunctionDefinition
                ) as FunctionDefinition;

                // Simple non-tuple case
                if (lhsPath.length === 0) {
                    replaceAssignmentHelper(factory, assignment, lib);
                } else {
                    // Tuple assignment case.
                    // @todo Do we need a new instrumentation type here?

                    const transCtx = instrCtx.getTranspilingCtx(
                        containingFun,
                        InstrumentationSiteType.StateVarUpdated
                    );

                    for (const [tempAssignment, tuplePath] of explodeTupleAssignment(
                        transCtx,
                        assignment
                    )) {
                        if (eq(tuplePath, lhsPath)) {
                            replaceAssignmentHelper(factory, tempAssignment, lib);
                        }
                    }
                }
            } else if (updateNode instanceof UnaryOperation) {
                const [base, index] = splitExpr(updateNode.vSubExpression);

                if (updateNode.operator === "delete") {
                    assert(updateNode.parent instanceof ExpressionStatement, ``);
                    const deleteKeyF = getDeleteKey(factory, lib);

                    const newNode = factory.makeFunctionCall(
                        "<missing>",
                        FunctionCallKind.FunctionCall,
                        deleteKeyF,
                        [base, index]
                    );
                    replaceNode(updateNode, newNode);
                } else {
                    assert(updateNode.operator === "++" || updateNode.operator == "--", ``);
                    const incDecF = getIncDecFun(
                        factory,
                        lib,
                        updateNode.operator,
                        updateNode.prefix
                    );
                    const newNode = factory.makeFunctionCall(
                        "<missing>",
                        FunctionCallKind.FunctionCall,
                        incDecF,
                        [base, index]
                    );
                    replaceNode(updateNode, newNode);
                }
            } else {
                /**
                 * Note that:
                 *
                 * 1) .push() and .pop() are handled by replacing IndexAccess-es
                 * 2) We dont need to worry about state var initializers, as those can't assign values to maps (the VariableDeclaration case)
                 */
                assert(
                    updateNode instanceof FunctionCall,
                    `NYI wrapping map update ${updateNode.constructor.name}`
                );
            }
        }

        // 3. Replace all index accesses `<base>[<key>]` on `T` with `L.get(<base>, <key>)`
        // All remaining references to the state var (and its part) that occur on
        // the LHS of some assignments have been handled in step 2. Therefore we can
        // replace the occuring references with calls to `L.get()`
        for (const [refNode] of findStateVarReferences(units, stateVar, path)) {
            const [base, index] = splitExpr(refNode);
            const getterF = getGetter(factory, lib);
            const newNode = factory.makeFunctionCall(
                "<misisng>",
                FunctionCallKind.FunctionCall,
                getterF,
                [base, index]
            );

            replaceNode(refNode, newNode);
        }
    }
}
