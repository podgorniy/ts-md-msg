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

export class MermaidConfig {
  theme = 'default';
  width = 1000;
  scale = 2;
  imageType = 'webp';
}

export class RenderConfig {
  private _markdownSymbol = new MarkdownSymbol();
  private _mermaid = new MermaidConfig();
  private _citeExpandable = true;

  get markdownSymbol(): MarkdownSymbol { return this._markdownSymbol; }
  get mermaid(): MermaidConfig { return this._mermaid; }
  get citeExpandable(): boolean { return this._citeExpandable; }
  set citeExpandable(value: boolean) { this._citeExpandable = value; }
}

let _runtimeConfig: RenderConfig | null = null;
export function getRuntimeConfig(): RenderConfig {
  if (!_runtimeConfig) {
    _runtimeConfig = new RenderConfig();
  }
  return _runtimeConfig;
}
