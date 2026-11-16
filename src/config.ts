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
  taskUncompleted = '☐';
  horizontalRule = '————————';
  // List markers: written after the indent, before the item text, never
  // covered by an entity
  unorderedListItem = '⦁';
  orderedListSuffix = '.';
}

/**
 * Render configuration for the entity backend.
 *
 * `getRuntimeConfig()` returns the process-global instance. It is shared
 * mutable state: when rendering must vary per chat or per request, build an
 * independent config with `RenderConfig.isolated()` (or `cfg.copy()`) and pass
 * it as `config` instead of mutating the global between awaits.
 */
export class RenderConfig {
  private _markdownSymbol = new MarkdownSymbol();
  private _citeExpandable = true;

  /** Build an independent config with default settings. */
  static isolated(): RenderConfig {
    return new RenderConfig();
  }

  /** Copy this config into an independent one, symbol table included. */
  copy(): RenderConfig {
    const clone = new RenderConfig();
    Object.assign(clone._markdownSymbol, this._markdownSymbol);
    clone._citeExpandable = this._citeExpandable;
    return clone;
  }

  get markdownSymbol(): MarkdownSymbol { return this._markdownSymbol; }
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
