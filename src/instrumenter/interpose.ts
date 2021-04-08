import {
    ASTNode,
    ASTNodeFactory,
    Block,
    ContractDefinition,
    DataLocation,
    Expression,
    ExpressionStatement,
    ExternalReferenceType,
    FunctionCall,
    FunctionCallKind,
    FunctionCallOptions,
    FunctionDefinition,
    FunctionKind,
    FunctionStateMutability,
    FunctionTypeName,
    FunctionVisibility,
    MemberAccess,
    Mutability,
    StateVariableVisibility,
    TypeName,
    VariableDeclaration
} from "solc-typed-ast";
import {
    ChangeArgumentLocation,
    ChangeFunctionDocumentation,
    ChangeFunctionKind,
    ChangeFunctionModifiers,
    ChangeFunctionMutability,
    ChangeFunctionOverrides,
    ChangeFunctionVirtual,
    ChangeVisibility,
    InsertArgument,
    InsertFunction,
    InsertFunctionBefore,
    InsertStatement,
    Recipe,
    Rename,
    RenameReturn,
    ReplaceCallee
} from "../rewriter";
import { SAddressType, SFunctionType, SPointer, SType } from "../spec-lang/ast";
import { parse as parseTypeString } from "../spec-lang/typeString_parser";
import { assert, getScopeFun, isChangingState, single } from "../util";
import { FunSet } from "./callgraph";
import { changesMutability } from "./instrument";
import { InstrumentationContext } from "./instrumentation_context";
import { generateTypeAst } from "./transpile";

const semver = require("semver");

function callOriginal(
    ctx: InstrumentationContext,
    stub: FunctionDefinition,
    original: FunctionDefinition
): ExpressionStatement {
    const factory = ctx.factory;
    const argIds = stub.vParameters.vParameters.map((decl) => factory.makeIdentifierFor(decl));
    const call = factory.makeFunctionCall(
        "<missing>",
        FunctionCallKind.FunctionCall,
        factory.makeIdentifierFor(original),
        argIds
    );

    const returnIds = stub.vReturnParameters.vParameters.map((decl) =>
        factory.makeIdentifierFor(decl)
    );

    /**
     * There is no need for assignments if there are no return parameters
     */
    if (returnIds.length === 0) {
        const exprStmt = factory.makeExpressionStatement(call);
        ctx.addGeneralInstrumentation(exprStmt);
        return exprStmt;
    }

    const lhs =
        returnIds.length === 1
            ? returnIds[0]
            : factory.makeTupleExpression("<missing>", false, returnIds);

    const assignment = factory.makeAssignment("<missing>", "=", lhs, call);

    const assignmentStmt = factory.makeExpressionStatement(assignment);
    ctx.addGeneralInstrumentation(assignmentStmt);

    return assignmentStmt;
}

function renameReturns(factory: ASTNodeFactory, stub: FunctionDefinition): Recipe {
    return stub.vReturnParameters.vParameters
        .filter((ret) => ret.name === "")
        .map((_, idx) => new RenameReturn(factory, stub, idx, `RET_${idx}`));
}

/**
 * Makes copy of a passed function with an empty body block
 */
function makeStub(fun: FunctionDefinition, factory: ASTNodeFactory): FunctionDefinition {
    const stub = factory.copy(fun);

    /**
     * Replace function body
     */
    const newBody = factory.makeBlock([]);

    stub.vBody = newBody;

    newBody.parent = stub;

    /**
     * Fix up parameters with missing names
     */
    let idx = 0;

    for (const param of stub.vParameters.vParameters) {
        if (param.name !== "") continue;

        // TODO: Check for accidental shadowing
        param.name = `_DUMMY_ARG_${idx++}`;
    }

    return stub;
}

/**
 * Given a function `fun` change the mutability of the transitive closure of callers/overriders/overridees which are
 * pure/view to non-payable
 *
 * @param fun - FunctionDefinition from which to start the search
 * @param ctx - InstrumentationContext
 * @param skipStartingFun - whether to skip changing the mutuability of `fun` itself.
 * @returns Recipe - recipe for changing the dependent's mutability
 */
function changeDependentsMutabilty(
    fun: FunctionDefinition,
    ctx: InstrumentationContext,
    skipStartingFun = false
): Recipe {
    const queue = [fun];
    const recipe: Recipe = [];
    // Walk back recursively through all callers, overriden and overriding functions of fun, and
    // mark all of those that have view/pure mutability to be modified.
    while (queue.length > 0) {
        const cur = queue.shift() as FunctionDefinition;

        if (isChangingState(cur) || ctx.funsToChangeMutability.has(cur)) {
            continue;
        }

        if (cur !== fun || !skipStartingFun) {
            ctx.funsToChangeMutability.add(cur);
            recipe.push(
                new ChangeFunctionMutability(ctx.factory, cur, FunctionStateMutability.NonPayable)
            );
        }

        queue.push(...(ctx.callgraph.callers.get(cur) as FunSet));
        queue.push(...(ctx.callgraph.overridenBy.get(cur) as FunSet));
        queue.push(...(ctx.callgraph.overrides.get(cur) as FunSet));
    }

    return recipe;
}

/**
 * Given a function `fun` generate the steps to create stub interposing on `fun`
 */
export function interpose(
    fun: FunctionDefinition,
    ctx: InstrumentationContext
): [Recipe, FunctionDefinition] {
    assert(
        fun.vScope instanceof ContractDefinition,
        "Instrumenting free functions is not supported yet"
    );

    const factory = ctx.factory;
    const stub = makeStub(fun, factory);

    // The compiler may emit some internal code related to named returns.
    for (const retDecl of stub.vReturnParameters.vParameters) {
        ctx.addGeneralInstrumentation(retDecl);
    }

    ctx.wrapperMap.set(fun, stub);

    const name = fun.kind === FunctionKind.Function ? fun.name : fun.kind;

    const recipe: Recipe = [
        new InsertFunctionBefore(factory, fun, stub),
        new Rename(
            factory,
            fun,
            ctx.nameGenerator.getFresh(`_original_${fun.vScope.name}_${name}`, true)
        )
    ];

    if (!isChangingState(stub) && changesMutability(ctx)) {
        stub.stateMutability = FunctionStateMutability.NonPayable;

        recipe.push(...changeDependentsMutabilty(fun, ctx, true));
    }

    if (fun.stateMutability === FunctionStateMutability.Payable) {
        recipe.push(new ChangeFunctionMutability(factory, fun, FunctionStateMutability.NonPayable));
    }

    recipe.push(
        new ChangeFunctionDocumentation(factory, fun, undefined),
        new ChangeFunctionDocumentation(factory, stub, undefined),
        new ChangeVisibility(factory, fun, FunctionVisibility.Private),
        ...renameReturns(factory, stub),
        new ChangeFunctionModifiers(factory, stub, []),
        new InsertStatement(
            factory,
            callOriginal.bind(undefined, ctx, stub, fun),
            "end",
            stub.vBody as Block
        ),
        new ChangeFunctionOverrides(factory, fun, undefined),
        new ChangeFunctionVirtual(factory, fun, false),
        new ChangeFunctionKind(factory, fun, FunctionKind.Function)
    );

    /**
     * In solc < 0.6.9 internal functions cannot have calldata arguments/returns.
     * In solc >= 0.6.9 they can have calldata arguments and returns.
     *
     * So in solc < 0.6.9 we should change arguments to memory.
     * If in solc < 0.6.9 the function returns a calldata array then it cannot be instrumented.
     *
     * For solc >= 0.6.9 we don't change the arguments' locations of the wrapped function.
     */
    if (semver.lt(ctx.compilerVersion, "0.6.9")) {
        for (const arg of fun.vReturnParameters.vParameters) {
            if (arg.storageLocation === DataLocation.CallData) {
                throw new Error(
                    `Scribble doesn't support instrumenting functions that return values in calldata for solc older than 0.6.9`
                );
            }
        }

        for (const arg of fun.vParameters.vParameters) {
            if (arg.storageLocation === DataLocation.CallData) {
                recipe.push(new ChangeArgumentLocation(factory, arg, DataLocation.Memory));
            }
        }
    }

    return [recipe, stub];
}

function copyDefs(
    defs: VariableDeclaration[],
    newParent: ASTNode,
    factory: ASTNodeFactory
): VariableDeclaration[] {
    return defs.map((def) =>
        factory.makeVariableDeclaration(
            false,
            false,
            ``,
            newParent.id,
            false,
            def.storageLocation === DataLocation.CallData
                ? DataLocation.Memory
                : def.storageLocation,
            StateVariableVisibility.Default,
            Mutability.Mutable,
            def.typeString,
            undefined,
            factory.copy(def.vType as TypeName)
        )
    );
}

function makeFunPtrType(f: FunctionDefinition, factory: ASTNodeFactory): FunctionTypeName {
    const funT = factory.makeFunctionTypeName(
        "<missing>",
        FunctionVisibility.External,
        f.stateMutability,
        factory.makeParameterList([]),
        factory.makeParameterList([])
    );

    const params = copyDefs(f.vParameters.vParameters, funT, factory);
    const returns = copyDefs(f.vReturnParameters.vParameters, funT, factory);

    funT.vParameterTypes.vParameters.push(...params);
    funT.vParameterTypes.acceptChildren();

    funT.vReturnParameterTypes.vParameters.push(...returns);
    funT.vReturnParameterTypes.acceptChildren();

    return funT;
}

/**
 * Given a `FunctionCall` `s`, extract the following from the callee:
 *  - gas option (if any)
 *  - value option (if any)
 *  - the underlying callee without the call options
 * @param s - `FunctionCall` whose callee we are decoding.
 */
function decodeCallsite(
    s: FunctionCall
): { callee: Expression; gas?: Expression; value?: Expression } {
    let callee = s.vExpression;
    let gas: Expression | undefined;
    let value: Expression | undefined;

    if (callee instanceof FunctionCallOptions) {
        gas = callee.vOptionsMap.get("gas");
        value = callee.vOptionsMap.get("value");
        callee = callee.vExpression;
    } else if (callee instanceof FunctionCall) {
        while (callee instanceof FunctionCall) {
            assert(
                callee.vExpression instanceof MemberAccess,
                `Unexpected callee: ${callee.print()}`
            );

            if (callee.vExpression.memberName === "gas") {
                gas = gas ? gas : single(callee.vArguments);
            } else if (callee.vExpression.memberName === "value") {
                value = value ? value : single(callee.vArguments);
            } else {
                assert(false, `Unexpected callee: ${callee.print()}`);
            }

            callee = callee.vExpression.vExpression;
        }
    }

    return { callee, gas, value };
}

function copySrc(originalNode: ASTNode, newNode: ASTNode): void {
    assert(originalNode.constructor === newNode.constructor, ``);
    newNode.src = originalNode.src;

    const originalChildren = originalNode.children;
    const newChildren = newNode.children;

    assert(originalChildren.length === newChildren.length, ``);

    for (let i = 0; i < originalChildren.length; i++) {
        copySrc(originalChildren[i], newChildren[i]);
    }
}

/**
 * Given an external function call node `call`, generate a wrapper function for `call` and
 * the recipe to replace `call` with a call to the wrapper function. This needs to handle
 * some builtin functions such as (address).{call, delegatecall, staticcall}().
 */
export function interposeCall(
    ctx: InstrumentationContext,
    contract: ContractDefinition,
    call: FunctionCall
): [Recipe, FunctionDefinition] {
    const factory = ctx.factory;
    const callsite = decodeCallsite(call);
    const callee = callsite.callee;
    const calleeT = parseTypeString(callee.typeString);

    assert(call.kind === FunctionCallKind.FunctionCall, "");
    assert(
        calleeT instanceof SFunctionType,
        `Expected function type, not ${calleeT.pp()} for callee in ${call.print()}`
    );

    let wrapperMut: FunctionStateMutability;

    // In `log` mode the wrapper is always non-payable. In 'mstore' all
    // functions preserve their mutability, unless they are payable (wrappers
    // can't be payable as they are internal)
    if (changesMutability(ctx)) {
        wrapperMut = FunctionStateMutability.NonPayable;
    } else {
        wrapperMut =
            calleeT.mutability === FunctionStateMutability.Payable
                ? FunctionStateMutability.NonPayable
                : calleeT.mutability;
    }

    const wrapper = factory.makeFunctionDefinition(
        contract.id,
        FunctionKind.Function,
        `_callsite_${call.id}`,
        false,
        FunctionVisibility.Private,
        wrapperMut,
        false,
        factory.makeParameterList([]),
        factory.makeParameterList([]),
        [],
        undefined,
        factory.makeBlock([])
    );

    ctx.addGeneralInstrumentation(wrapper);

    const params: VariableDeclaration[] = [];
    const returns: VariableDeclaration[] = [];

    let receiver: Expression;
    let callOriginalExp: Expression;

    if (call.vFunctionCallType === ExternalReferenceType.UserDefined) {
        const calleeDef = call.vReferencedDeclaration;

        assert(calleeDef !== undefined && calleeDef instanceof FunctionDefinition, ``);

        const fPtrT = makeFunPtrType(calleeDef, factory);

        params.push(
            factory.makeVariableDeclaration(
                false,
                false,
                `fPtr`,
                wrapper.id,
                false,
                DataLocation.Default,
                StateVariableVisibility.Default,
                Mutability.Mutable,
                calleeT.pp(),
                undefined,
                fPtrT
            )
        );

        params.push(
            ...calleeDef.vParameters.vParameters.map((originalDef, idx) =>
                factory.makeVariableDeclaration(
                    false,
                    false,
                    `arg${idx}`,
                    wrapper.id,
                    false,
                    originalDef.storageLocation === DataLocation.CallData
                        ? DataLocation.Memory
                        : originalDef.storageLocation,
                    StateVariableVisibility.Default,
                    Mutability.Mutable,
                    originalDef.typeString,
                    undefined,
                    factory.copy(originalDef.vType as TypeName)
                )
            )
        );

        returns.push(
            ...calleeDef.vReturnParameters.vParameters.map((originalDef, idx) =>
                factory.makeVariableDeclaration(
                    false,
                    false,
                    `ret${idx}`,
                    wrapper.id,
                    false,
                    originalDef.storageLocation === DataLocation.CallData
                        ? DataLocation.Memory
                        : originalDef.storageLocation,
                    StateVariableVisibility.Default,
                    Mutability.Mutable,
                    originalDef.typeString,
                    undefined,
                    factory.copy(originalDef.vType as TypeName)
                )
            )
        );

        receiver = factory.copy(callee);
        copySrc(callee, receiver);

        callOriginalExp = factory.makeIdentifierFor(params[0]);
    } else {
        assert(callee instanceof MemberAccess, ``);

        const baseT = parseTypeString(callee.vExpression.typeString);

        assert(baseT instanceof SAddressType, ``);
        assert(["call", "delegatecall", "staticcall"].includes(callee.memberName), ``);

        params.push(
            factory.makeVariableDeclaration(
                false,
                false,
                `receiver`,
                wrapper.id,
                false,
                DataLocation.Default,
                StateVariableVisibility.Default,
                Mutability.Mutable,
                callee.vExpression.typeString,
                undefined,
                generateTypeAst(baseT, factory)
            )
        );

        const getTypeAndLoc = (t: SType): [TypeName, DataLocation] => {
            return t instanceof SPointer
                ? [generateTypeAst(t.to, factory), t.location]
                : [generateTypeAst(t, factory), DataLocation.Default];
        };

        calleeT.parameters.forEach((paramT, idx) => {
            const [type, loc] = getTypeAndLoc(paramT);

            params.push(
                factory.makeVariableDeclaration(
                    false,
                    false,
                    `arg${idx}`,
                    wrapper.id,
                    false,
                    loc,
                    StateVariableVisibility.Default,
                    Mutability.Mutable,
                    paramT.pp(),
                    undefined,
                    type
                )
            );
        });

        calleeT.returns.forEach((retT, idx) => {
            const [type, loc] = getTypeAndLoc(retT);
            returns.push(
                factory.makeVariableDeclaration(
                    false,
                    false,
                    `ret${idx}`,
                    wrapper.id,
                    false,
                    loc,
                    StateVariableVisibility.Default,
                    Mutability.Mutable,
                    retT.pp(),
                    undefined,
                    type
                )
            );
        });

        receiver = factory.copy(callee.vExpression);
        copySrc(callee.vExpression, receiver);

        callOriginalExp = factory.makeMemberAccess(
            call.vExpression.typeString,
            factory.makeIdentifierFor(params[0]),
            callee.memberName,
            -1
        );
    }

    const recipe: Recipe = [];
    let nImplicitArgs = 1;

    /**
     * If the original call had gas/value function call options, we need
     * to turn those into arguments for the callsite wrapper.
     */
    if (callsite.gas || callsite.value) {
        const options: Map<string, Expression> = new Map();

        for (const [name, expr] of [
            ["gas", callsite.gas],
            ["value", callsite.value]
        ] as Array<[string, Expression]>) {
            if (expr === undefined) {
                continue;
            }

            const param = factory.makeVariableDeclaration(
                false,
                false,
                `_${name}`,
                wrapper.id,
                false,
                DataLocation.Default,
                StateVariableVisibility.Default,
                Mutability.Mutable,
                "uint256",
                undefined,
                factory.makeElementaryTypeName("<missing>", "uint256")
            );

            params.splice(1, 0, param);
            options.set(name, factory.makeIdentifierFor(param));
            recipe.push(new InsertArgument(factory, expr, "after", call, receiver));
            nImplicitArgs++;
        }

        if (semver.lt(ctx.compilerVersion, "0.6.2")) {
            for (const [name, val] of options) {
                callOriginalExp = factory.makeFunctionCall(
                    "<missing>",
                    FunctionCallKind.FunctionCall,
                    factory.makeMemberAccess("<missing>", callOriginalExp, name, -1),
                    [val]
                );
            }
        } else {
            callOriginalExp = factory.makeFunctionCallOptions(
                "<missing>",
                callOriginalExp,
                options
            );
        }
    }

    wrapper.vParameters.vParameters.push(...params);
    wrapper.vReturnParameters.vParameters.push(...returns);

    let callOriginal: Expression = factory.makeFunctionCall(
        call.typeString,
        FunctionCallKind.FunctionCall,
        callOriginalExp,
        params.slice(nImplicitArgs).map((param) => factory.makeIdentifierFor(param))
    );

    if (wrapper.vReturnParameters.vParameters.length !== 0) {
        callOriginal = factory.makeAssignment(
            "<missing>",
            "=",
            factory.makeTupleExpression(
                "<missing>",
                false,
                wrapper.vReturnParameters.vParameters.map((param) =>
                    factory.makeIdentifierFor(param)
                )
            ),
            callOriginal
        );
    }

    (wrapper.vBody as Block).appendChild(factory.makeExpressionStatement(callOriginal));

    const newCallee = factory.makeIdentifierFor(wrapper);
    newCallee.src = call.vExpression.src;

    recipe.push(
        new InsertFunction(factory, contract, wrapper),
        new ReplaceCallee(factory, call.vExpression, newCallee),
        new InsertArgument(factory, receiver, "start", call)
    );

    // If the call is in a pure/view function change its mutability
    const containingFun = getScopeFun(call);
    if (containingFun !== undefined && !isChangingState(containingFun) && changesMutability(ctx)) {
        recipe.push(...changeDependentsMutabilty(containingFun, ctx));
    }

    return [recipe, wrapper];
}

/**
 * Replace the node `oldNode` in the tree with `newNode`.
 *
 * If `p` is the parent of `oldNode`, this function needs to find a property
 * `propName` of `p` such that `p[propName] === oldNode`. `ASTNode`s have both
 * own properties and getters/setters, so this function first:
 *
 * 1. Iterates over the own properties of `p`
 * 2. Walks the prototype chain of `p` iterating over all getters/setters
 *
 * Once found, it re-assigns `p[propName] = newNode` and sets
 * `newNode.parent=p` using `acceptChildren`. Since `children` is a getter
 * there is nothing further to do.
 *
 * @param oldNode - old node to replace
 * @param newNode - new node with which we are replacing it
 */
export function replaceNode(oldNode: ASTNode, newNode: ASTNode): void {
    assert(oldNode.context === newNode.context, `Context mismatch`);
    const parent = oldNode.parent;

    if (!parent) return;

    // First check if parent has an OWN property with the child
    const ownProps = Object.getOwnPropertyDescriptors(parent);
    for (const propName in ownProps) {
        const propVal = ownProps[propName].value;
        if (propVal === oldNode) {
            const tmpObj: any = {};
            tmpObj[propName] = newNode;

            Object.assign(parent, tmpObj);
            parent.acceptChildren();
            return;
        }

        if (propVal instanceof Array) {
            for (let i = 0; i < propVal.length; i++) {
                if (propVal[i] === oldNode) {
                    propVal[i] = newNode;
                    parent.acceptChildren();
                    return;
                }
            }
        }
    }

    // If not, walk up the inheritance tree, looking for a getter/setter pair that matches
    // this child
    let proto = Object.getPrototypeOf(parent);

    while (proto) {
        for (const name of Object.getOwnPropertyNames(proto)) {
            if (name === "__proto__") {
                continue;
            }

            const descriptor = Object.getOwnPropertyDescriptor(proto, name);

            if (
                descriptor &&
                typeof descriptor.get === "function" &&
                typeof descriptor.set === "function"
            ) {
                const val = descriptor.get.call(parent);
                if (val === oldNode) {
                    descriptor.set.call(parent, newNode);
                    parent.acceptChildren();
                    return;
                }
            }
        }

        proto = Object.getPrototypeOf(proto);
    }

    assert(
        false,
        `Couldn't find child ${oldNode.type}#${oldNode.id} under parent ${parent.type}#${parent.id}`
    );
}
