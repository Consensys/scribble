// Need the ts-nocheck to suppress the noUnusedLocals errors in the generated parser
// @ts-nocheck
export interface SymbolDesc {
    name: string;
    alias: string;
}

export interface ImportDirectiveDesc {
    path: string;
    unitAlias: string | undefined;
    symbolAliases: SymbolDesc[];
}
