export declare enum CombiningType {
    FirstChar = 1,
    LastChar = 2,
    EveryChar = 3
}
export declare const LATEX_SYMBOLS: Record<string, string>;
export declare const COMBINING: Record<string, [string, CombiningType]>;
export declare const NOT_MAP: Record<string, string>;
export declare const SUBSCRIPTS: Record<string, string>;
export declare const SUPERSCRIPTS: Record<string, string>;
export declare const LATEX_STYLES: Record<string, Record<string, string>>;
export declare const FRAC_MAP: Record<string, string>;
