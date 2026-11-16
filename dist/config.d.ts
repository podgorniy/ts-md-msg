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
    unorderedListItem: string;
    orderedListSuffix: string;
}
/**
 * Render configuration for the entity backend.
 *
 * `getRuntimeConfig()` returns the process-global instance. It is shared
 * mutable state: when rendering must vary per chat or per request, build an
 * independent config with `RenderConfig.isolated()` (or `cfg.copy()`) and pass
 * it as `config` instead of mutating the global between awaits.
 */
export declare class RenderConfig {
    private _markdownSymbol;
    private _citeExpandable;
    /** Build an independent config with default settings. */
    static isolated(): RenderConfig;
    /** Copy this config into an independent one, symbol table included. */
    copy(): RenderConfig;
    get markdownSymbol(): MarkdownSymbol;
    get citeExpandable(): boolean;
    set citeExpandable(value: boolean);
}
export declare function getRuntimeConfig(): RenderConfig;
