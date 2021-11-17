import { SBooleanLiteral } from "../boolean_literal";
import { Range, SNode } from "../node";
import { SNumber } from "../number";
import { SStringLiteral } from "../string_literal";
export enum AnnotationType {
    IfSucceeds = "if_succeeds",
    IfUpdated = "if_updated",
    IfAssigned = "if_assigned",
    Invariant = "invariant",
    Define = "define",
    Assert = "assert",
    Try = "try",
    Require = "require"
}

export type AnnotationMDExpr = SNumber | SBooleanLiteral | SStringLiteral;
export type AnnotationMD = { [key: string]: AnnotationMDExpr };

const knownMDTypes = new Map<string, any>([["msg", SStringLiteral]]);

export abstract class SAnnotation extends SNode {
    public readonly type: AnnotationType;
    public readonly md: AnnotationMD;
    public readonly label?: string;

    prefix: string | undefined;

    constructor(type: AnnotationType, md?: AnnotationMD, src?: Range) {
        super(src);
        this.type = type;

        this.md = md ? md : {};

        for (const [key, val] of Object.entries(this.md)) {
            const expectedType = knownMDTypes.get(key);

            if (!expectedType) {
                throw new Error(`Unknown annotation metadata key ${key}`);
            }

            if (!(val instanceof expectedType)) {
                throw new Error(
                    `Expected key ${key} to be a ${expectedType}, not ${val} of type ${typeof val}`
                );
            }

            if (key === "msg") {
                this.label = (val as SStringLiteral).val;
            } else {
                throw new Error(`NYI metadata key ${key}`);
            }
        }
    }
}
