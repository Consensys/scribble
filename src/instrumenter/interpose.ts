import {
    AddressType,
    ASTNode,
    ASTNodeFactory,
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
    FunctionType,
    FunctionVisibility,
    getNodeType,
    MemberAccess,
    Mutability,
    PointerType,
    StateVariableVisibility,
    TypeName,
    TypeNode,
    UserDefinedType,
    VariableDeclaration
} from "solc-typed-ast";
import { assert, getFQName, getScopeFun, isChangingState, single } from "../util";
import { FunSet } from "./callgraph";
import { changesMutability } from "./instrument";
import { InstrumentationContext } from "./instrumentation_context";
import { transpileType } from "./transpile";

const semver = require("semver");

/**
 * Generate a Statement calling the passed-in `original` function from the `stub` function.
 *
 * Note that `original` and `stub` must have the same arguments.
 */
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

/**
 * Rename any unnamed returns for the given `stub` function to `RET_<x>`.
 */
function renameReturns(stub: FunctionDefinition): void {
    for (let i = 0; i < stub.vReturnParameters.vParameters.length; i++) {
        const param = stub.vReturnParameters.vParameters[i];
        if (param.name === "") {
            param.name = `RET_${i}`;
        }
    }
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
 */
function changeDependentsMutabilty(
    fun: FunctionDefinition,
    ctx: InstrumentationContext,
    skipStartingFun = false
) {
    const queue = [fun];
    const seen = new Set<FunctionDefinition>();
    // Walk back recursively through all callers, overriden and overriding functions of fun, and
    // mark all of those that have view/pure mutability to be modified.
    while (queue.length > 0) {
        const cur = queue.shift() as FunctionDefinition;

        if (isChangingState(cur) || seen.has(cur)) {
            continue;
        }

        if (cur !== fun || !skipStartingFun) {
            seen.add(cur);

            cur.stateMutability = FunctionStateMutability.NonPayable;
        }

        queue.push(...(ctx.callgraph.callers.get(cur) as FunSet));
        queue.push(...(ctx.callgraph.overridenBy.get(cur) as FunSet));
        queue.push(...(ctx.callgraph.overrides.get(cur) as FunSet));
    }
}

/**
 * Given a function `fun` create a stub interposing on `fun` and rename the original function
 */
export function interpose(
    fun: FunctionDefinition,
    ctx: InstrumentationContext
): FunctionDefinition {
    assert(
        fun.vScope instanceof ContractDefinition,
        "Instrumenting free functions is not supported yet"
    );

    const factory = ctx.factory;
    const stub = makeStub(fun, factory);
    const contract = fun.vScope;

    // The compiler may emit some internal code related to named returns.
    for (const retDecl of stub.vReturnParameters.vParameters) {
        ctx.addGeneralInstrumentation(retDecl);
    }

    ctx.wrapperMap.set(fun, stub);

    const name = fun.kind === FunctionKind.Function ? fun.name : fun.kind;

    contract.insertBefore(stub, fun);
    fun.name = ctx.nameGenerator.getFresh(`_original_${fun.vScope.name}_${name}`, true);

    if (!isChangingState(stub) && changesMutability(ctx)) {
        stub.stateMutability = FunctionStateMutability.NonPayable;

        changeDependentsMutabilty(fun, ctx, true);
    }

    if (fun.stateMutability === FunctionStateMutability.Payable) {
        fun.stateMutability = FunctionStateMutability.NonPayable;
    }

    fun.documentation = undefined;
    stub.documentation = undefined;
    fun.visibility = FunctionVisibility.Private;
    fun.isConstructor = false;
    renameReturns(stub);
    stub.vModifiers = [];
    stub.vBody?.appendChild(callOriginal(ctx, stub, fun));
    fun.vOverrideSpecifier = undefined;
    fun.virtual = false;
    fun.kind = FunctionKind.Function;

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
                arg.storageLocation = DataLocation.Memory;
            }
        }
    }

    return stub;
}

/**
 * Given a `FunctionCall` `s`, extract the following from the callee:
 *  - gas option (if any)
 *  - value option (if any)
 *  - the underlying callee without the call options
 * @param s - `FunctionCall` whose callee we are decoding.
 */
function decodeCallsite(s: FunctionCall): {
    callee: Expression;
    gas?: Expression;
    value?: Expression;
} {
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
): FunctionDefinition {
    const factory = ctx.factory;
    const callsite = decodeCallsite(call);
    const callee = callsite.callee;
    const calleeT = getNodeType(callee, ctx.compilerVersion);

    assert(call.kind === FunctionCallKind.FunctionCall, "");
    assert(
        calleeT instanceof FunctionType,
        `Expected external function type, not ${calleeT.pp()} for callee in ${call.print()}`
    );
    assert(
        callee instanceof MemberAccess,
        `Expected a MemberAccess as external call callee, not ${callee.print()}`
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
    const baseT = getNodeType(callee.vExpression, ctx.compilerVersion);

    if (call.vFunctionCallType === ExternalReferenceType.UserDefined) {
        assert(
            baseT instanceof UserDefinedType && baseT.definition instanceof ContractDefinition,
            `Expected base to be a reference to a contract, not ${baseT.pp()}`
        );

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
                baseT.pp(),
                undefined,
                factory.makeUserDefinedTypeName(
                    "<missing>",
                    getFQName(baseT.definition, call),
                    baseT.definition.id
                )
            )
        );

        params.push(
            ...calleeT.parameters.map((paramT, idx) =>
                factory.typeNodeToVariableDecl(paramT, `arg${idx}`, call)
            )
        );

        returns.push(
            ...calleeT.returns.map((retT, idx) =>
                factory.typeNodeToVariableDecl(retT, `ret${idx}`, call)
            )
        );

        receiver = factory.copy(callee.vExpression);
        copySrc(callee.vExpression, receiver);

        callOriginalExp = factory.makeMemberAccess(
            call.vExpression.typeString,
            factory.makeIdentifierFor(params[0]),
            callee.memberName,
            callee.referencedDeclaration
        );
    } else {
        assert(baseT instanceof AddressType, ``);
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
                transpileType(baseT, factory)
            )
        );

        const getTypeAndLoc = (t: TypeNode): [TypeName, DataLocation] => {
            return t instanceof PointerType
                ? [transpileType(t.to, factory), t.location]
                : [transpileType(t, factory), DataLocation.Default];
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

            // Insert implicit gas arguments at begining
            call.vArguments.splice(0, 0, expr);
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

    factory.addStmt(wrapper, callOriginal);

    const newCallee = factory.makeIdentifierFor(wrapper);

    newCallee.src = call.vExpression.src;

    contract.appendChild(wrapper);
    call.vExpression = newCallee;
    call.vArguments.unshift(receiver);

    // If the call is in a pure/view function change its mutability
    const containingFun = getScopeFun(call);

    if (containingFun !== undefined && !isChangingState(containingFun) && changesMutability(ctx)) {
        changeDependentsMutabilty(containingFun, ctx);
    }

    return wrapper;
}
