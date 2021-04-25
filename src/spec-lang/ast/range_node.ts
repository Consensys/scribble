import { SNode, Range } from ".";


/**
 */
export class SItrRange extends SNode {
    public readonly start;
    public readonly end;
    public readonly includeOpen;
    public readonly includeClose;
    public readonly label?: string;
    constructor(start: Number, end: Number, open: string, close: string, src?: Range) {
        super(src);
        this.start = start
        this.end = end;
        if (open == "[")
            this.includeOpen = true;
        else
            this.includeOpen = false;
        if (close == "]")
            this.includeClose = true;
        else
            this.includeClose = false;

    }

    pp(): string {
        let openBr = "("
        let closeBr = ")"
        if (this.includeOpen)
            openBr = "["
        if (this.includeClose)
            closeBr = "]"
        return `${openBr} ${this.start} ... ${this.end} ${closeBr}`;
    }

    getFields(): any[] {
        return [this.start, this.end, this.includeOpen, this.includeClose];
    }
}
