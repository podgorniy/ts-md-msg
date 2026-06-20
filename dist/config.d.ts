export declare class MarkdownSymbol {
    headingLevel1: string;
    headingLevel2: string;
    headingLevel3: string;
    headingLevel4: string;
    headingLevel5: string;
    headingLevel6: string;
    image: string;
    link: string;
    taskCompleted: string;
    taskUncompleted: string;
    horizontalRule: string;
}
export declare class RenderConfig {
    private _markdownSymbol;
    private _citeExpandable;
    get markdownSymbol(): MarkdownSymbol;
    get citeExpandable(): boolean;
    set citeExpandable(value: boolean);
}
export declare function getRuntimeConfig(): RenderConfig;
