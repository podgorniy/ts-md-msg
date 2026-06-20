export class MarkdownSymbol {
    headingLevel1 = '📌';
    headingLevel2 = '✏️';
    headingLevel3 = '📚';
    headingLevel4 = '🔖';
    headingLevel5 = '';
    headingLevel6 = '';
    image = '🖼';
    link = '🔗';
    taskCompleted = '✅';
    taskUncompleted = '☑️';
    horizontalRule = '————————';
}
export class RenderConfig {
    _markdownSymbol = new MarkdownSymbol();
    _citeExpandable = true;
    get markdownSymbol() { return this._markdownSymbol; }
    get citeExpandable() { return this._citeExpandable; }
    set citeExpandable(value) { this._citeExpandable = value; }
}
let _runtimeConfig = null;
export function getRuntimeConfig() {
    if (!_runtimeConfig) {
        _runtimeConfig = new RenderConfig();
    }
    return _runtimeConfig;
}
