export interface Range {
  start: number;
  end: number;
}

export type Event =
  | 'SoftBreak'
  | 'HardBreak'
  | 'Rule'
  | { Start: Tag }
  | { End: Tag }
  | { Text: string }
  | { Code: string }
  | { InlineMath: string }
  | { DisplayMath: string }
  | { Html: string }
  | { InlineHtml: string }
  | { FootnoteReference: string }
  | { TaskListMarker: boolean };

export type Tag =
  | 'Paragraph'
  | 'Strong'
  | 'Emphasis'
  | 'Strikethrough'
  | 'BlockQuote'
  | 'Item'
  | 'TableHead'
  | 'TableRow'
  | 'TableCell'
  | 'HtmlBlock'
  | 'FootnoteDefinition'
  | { Heading: { level: string; id: string | null; classes: string[] } }
  | { CodeBlock: 'Indented' | { Fenced: string } }
  | { List: number | null }
  | { Link: { link_type: string; dest_url: string; title: string; id: string } }
  | { Image: { link_type: string; dest_url: string; title: string; id: string } }
  | { Table: string[] };

export interface Segment {
  kind: 'text' | 'code_block' | 'mermaid';
  textStart: number;
  textEnd: number;
  utf16Start: number;
  utf16End: number;
  language: string;
  rawCode: string;
}
