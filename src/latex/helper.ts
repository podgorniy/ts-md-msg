import {
  COMBINING,
  CombiningType,
  FRAC_MAP,
  LATEX_STYLES,
  LATEX_SYMBOLS,
  NOT_MAP,
  SUBSCRIPTS,
  SUPERSCRIPTS,
} from './const.js';

export class LatexToUnicodeHelper {
  private static isCombiningChar(char: string): boolean {
    const code = char.charCodeAt(0);
    return (
      (code >= 0x0300 && code <= 0x036f) ||
      (code >= 0x1ab0 && code <= 0x1aff) ||
      (code >= 0x1dc0 && code <= 0x1dff) ||
      (code >= 0x20d0 && code <= 0x20ff) ||
      (code >= 0xfe20 && code <= 0xfe2f)
    );
  }

  private static translateCombining(command: string, text: string): string {
    const sample = COMBINING[command];
    if (!sample) return text;
    const [combiningChar, combiningType] = sample;

    if (combiningType === CombiningType.FirstChar) {
      let i = 1;
      while (i < text.length && (text[i].trim() === '' || this.isCombiningChar(text[i]))) {
        i++;
      }
      return text.substring(0, i) + combiningChar + text.substring(i);
    } else if (combiningType === CombiningType.LastChar) {
      return text + combiningChar;
    } else if (combiningType === CombiningType.EveryChar) {
      let result = '';
      for (let i = 0; i < text.length; i++) {
        result += text[i] + combiningChar;
      }
      return result;
    }
    return text;
  }

  private static makeNot(negated: string): string {
    const trimmed = negated.trim();
    if (!trimmed) return ' ';
    return NOT_MAP[trimmed] || `${trimmed[0]}\u0338${trimmed.substring(1)}`;
  }

  private static tryMakeSubscript(text: string): string | null {
    if (!text) return '';
    let result = '';
    for (const ch of text) {
      if (ch in SUBSCRIPTS) {
        result += SUBSCRIPTS[ch];
      } else {
        return null;
      }
    }
    return result;
  }

  private static makeSubscript(text: string): string {
    text = text.trim();
    if (!text) return '';
    const sub = this.tryMakeSubscript(text);
    if (sub !== null) return sub;
    if (text.length === 1) return SUBSCRIPTS[text] || `_${text}`;
    return `_(${text})`;
  }

  private static tryMakeSuperscript(text: string): string | null {
    if (!text) return '';
    let result = '';
    for (const ch of text) {
      if (ch in SUPERSCRIPTS) {
        result += SUPERSCRIPTS[ch];
      } else {
        return null;
      }
    }
    return result;
  }

  private static makeSuperscript(text: string): string {
    text = text.trim();
    if (!text) return '';
    const sup = this.tryMakeSuperscript(text);
    if (sup !== null) return sup;
    if (text.length === 1) return SUPERSCRIPTS[text] || `^${text}`;
    return `^(${text})`;
  }

  private static translateStyles(command: string, text: string): string {
    const styleMap = LATEX_STYLES[command];
    if (!styleMap) {
      throw new Error(`Unknown style command: ${command}`);
    }
    let result = '';
    for (const char of text) {
      result += styleMap[char] || char;
    }
    return result;
  }

  private static makeSqrt(index: string, radicand: string): string {
    let radix = '';
    if (index === '') radix = '√';
    else if (index === '2') radix = '√';
    else if (index === '3') radix = '∛';
    else if (index === '4') radix = '∜';
    else radix = (this.tryMakeSuperscript(index) || `(${index})`) + '√';

    return radix + this.translateCombining('\\overline', radicand);
  }

  private static translateSqrt(command: string, option: string, param: string): string {
    if (command !== '\\sqrt') throw new Error(`Unknown command: ${command}`);
    return this.makeSqrt(option.trim(), param.trim());
  }

  private static maybeParenthesize(text: string): string {
    const needsParens = (char: string) => {
      const code = char.charCodeAt(0);
      const isAlnum =
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122);
      return !(isAlnum || this.isCombiningChar(char) || char === '_');
    };
    for (const c of text) {
      if (needsParens(c)) return `(${text})`;
    }
    return text;
  }

  private static makeFraction(numerator: string, denominator: string): string {
    const n = numerator.trim();
    const d = denominator.trim();
    if (!n && !d) return '';
    const key = `${n},${d}`;
    if (FRAC_MAP[key]) return FRAC_MAP[key];
    return `${this.maybeParenthesize(n)}/${this.maybeParenthesize(d)}`;
  }

  private static translateFrac(command: string, numerator: string, denominator: string): string {
    if (command !== '\\frac') throw new Error(`Unknown command: ${command}`);
    return this.makeFraction(numerator, denominator);
  }

  private static translateEscape(name: string): string {
    const val = LATEX_SYMBOLS[name];
    return val !== undefined ? val : name;
  }

  public parse(latex: string): string {
    let result = '';
    let i = 0;
    while (i < latex.length) {
      if (latex[i] === '\\') {
        const cmdRes = this.parseCommand(latex, i);
        let command = cmdRes.command;
        i = cmdRes.nextIndex;

        if (command === '\\frac' && result.length > 0 && result[result.length - 1].match(/\d/)) {
          result += ' ';
        }

        const handleRes = this.handleCommand(command, latex, i);
        result += handleRes.handled;
        i = handleRes.nextIndex;
      } else if (latex[i] === '{') {
        const blockRes = this.parseBlock(latex, i);
        result += blockRes.block;
        i = blockRes.nextIndex;
      } else if (latex[i] === '_' || latex[i] === '^') {
        const sym = latex[i];
        let arg = '';
        i++;
        if (i < latex.length && latex[i] === '{') {
          const blockRes = this.parseBlock(latex, i);
          arg = blockRes.block;
          i = blockRes.nextIndex;
        } else if (i < latex.length && latex[i] === '\\') {
          const cmdRes = this.parseCommand(latex, i);
          const command = cmdRes.command;
          i = cmdRes.nextIndex;
          if (command === '\\frac' && result.length > 0 && result[result.length - 1].match(/\d/)) {
            result += ' ';
          }
          const handleRes = this.handleCommand(command, latex, i);
          arg = handleRes.handled;
          i = handleRes.nextIndex;
        } else if (i < latex.length) {
          arg = latex[i];
          i++;
        }
        result += sym === '_' ? LatexToUnicodeHelper.makeSubscript(arg) : LatexToUnicodeHelper.makeSuperscript(arg);
      } else if (latex[i].trim() === '') {
        const spacesRes = this.parseSpaces(latex, i);
        result += spacesRes.spaces;
        i = spacesRes.nextIndex;
      } else {
        result += latex[i];
        i++;
      }
    }
    return result;
  }

  private handleCommand(command: string, latex: string, index: number): { handled: string; nextIndex: number } {
    if (command in LATEX_SYMBOLS) {
      return { handled: LatexToUnicodeHelper.translateEscape(command), nextIndex: index };
    } else if (command === '\\not') {
      if (index < latex.length) {
        if (latex[index] === '\\') {
          const nextCmdRes = this.parseCommand(latex, index);
          const symbol = LATEX_SYMBOLS[nextCmdRes.command] || nextCmdRes.command;
          return { handled: LatexToUnicodeHelper.makeNot(symbol), nextIndex: nextCmdRes.nextIndex };
        } else {
          return { handled: LatexToUnicodeHelper.makeNot(latex[index]), nextIndex: index + 1 };
        }
      }
      return { handled: '\u0338', nextIndex: index };
    } else if (command in COMBINING) {
      const argRes = this.parseBlock(latex, index);
      return { handled: LatexToUnicodeHelper.translateCombining(command, argRes.block), nextIndex: argRes.nextIndex };
    } else if (command === '\\frac') {
      const numerRes = this.parseBlock(latex, index);
      const denomRes = this.parseBlock(latex, numerRes.nextIndex);
      return { handled: LatexToUnicodeHelper.makeFraction(numerRes.block, denomRes.block), nextIndex: denomRes.nextIndex };
    } else if (command === '\\sqrt') {
      const optionRes = this.parseOptional(latex, index);
      const paramRes = this.parseBlock(latex, optionRes.nextIndex);
      return { handled: LatexToUnicodeHelper.translateSqrt(command, optionRes.option, paramRes.block), nextIndex: paramRes.nextIndex };
    } else if (command in LATEX_STYLES) {
      const textRes = this.parseBlock(latex, index);
      return { handled: LatexToUnicodeHelper.translateStyles(command, textRes.block), nextIndex: textRes.nextIndex };
    } else if (['\\text', '\\operatorname', '\\mbox', '\\textrm', '\\textup', '\\mathop'].includes(command)) {
      const textRes = this.parseBlock(latex, index);
      return { handled: textRes.block, nextIndex: textRes.nextIndex };
    } else if (['\\left', '\\right'].includes(command)) {
      const delimRes = this.parseDelimiter(latex, index);
      return { handled: delimRes.delim, nextIndex: delimRes.nextIndex };
    } else if (['\\binom', '\\tbinom', '\\dbinom'].includes(command)) {
      const nRes = this.parseBlock(latex, index);
      const kRes = this.parseBlock(latex, nRes.nextIndex);
      return { handled: `C(${nRes.block},${kRes.block})`, nextIndex: kRes.nextIndex };
    } else if (command === '\\boxed') {
      const textRes = this.parseBlock(latex, index);
      return { handled: `[${textRes.block}]`, nextIndex: textRes.nextIndex };
    } else if (command === '\\pmod') {
      const textRes = this.parseBlock(latex, index);
      return { handled: ` (mod ${textRes.block})`, nextIndex: textRes.nextIndex };
    } else if (['\\phantom', '\\hphantom', '\\vphantom'].includes(command)) {
      const textRes = this.parseBlock(latex, index);
      return { handled: ' '.repeat(Math.max(textRes.block.length, 1)), nextIndex: textRes.nextIndex };
    } else if (command === '\\overset') {
      const overRes = this.parseBlock(latex, index);
      const baseRes = this.parseBlock(latex, overRes.nextIndex);
      const sup = LatexToUnicodeHelper.tryMakeSuperscript(overRes.block);
      return { handled: sup ? `${baseRes.block}${sup}` : `${baseRes.block}^(${overRes.block})`, nextIndex: baseRes.nextIndex };
    } else if (command === '\\underset') {
      const underRes = this.parseBlock(latex, index);
      const baseRes = this.parseBlock(latex, underRes.nextIndex);
      const sub = LatexToUnicodeHelper.tryMakeSubscript(underRes.block);
      return { handled: sub ? `${baseRes.block}${sub}` : `${baseRes.block}_(${underRes.block})`, nextIndex: baseRes.nextIndex };
    } else if (command === '\\stackrel') {
      const overRes = this.parseBlock(latex, index);
      const baseRes = this.parseBlock(latex, overRes.nextIndex);
      const sup = LatexToUnicodeHelper.tryMakeSuperscript(overRes.block);
      return { handled: sup ? `${baseRes.block}${sup}` : `${baseRes.block}^(${overRes.block})`, nextIndex: baseRes.nextIndex };
    } else if (command === '\\substack') {
      const textRes = this.parseBlock(latex, index);
      const lines = textRes.block.split('\\\\').map((l) => l.trim()).filter((l) => l);
      return { handled: lines.map((l) => this.parse(l)).join(', '), nextIndex: textRes.nextIndex };
    } else if (command === '\\color') {
      const textRes = this.parseBlock(latex, index);
      return { handled: '', nextIndex: textRes.nextIndex };
    } else if (['\\cancel', '\\bcancel', '\\xcancel', '\\sout'].includes(command)) {
      const textRes = this.parseBlock(latex, index);
      return { handled: LatexToUnicodeHelper.translateCombining('\\underline', textRes.block), nextIndex: textRes.nextIndex };
    } else if (command === '\\overbrace') {
      const textRes = this.parseBlock(latex, index);
      return { handled: LatexToUnicodeHelper.translateCombining('\\overline', textRes.block), nextIndex: textRes.nextIndex };
    } else if (command === '\\underbrace') {
      const textRes = this.parseBlock(latex, index);
      return { handled: LatexToUnicodeHelper.translateCombining('\\underline', textRes.block), nextIndex: textRes.nextIndex };
    } else if (command === '\\xrightarrow') {
      const textRes = this.parseBlock(latex, index);
      return { handled: textRes.block.trim() ? `→(${textRes.block})` : '→', nextIndex: textRes.nextIndex };
    } else if (command === '\\xleftarrow') {
      const textRes = this.parseBlock(latex, index);
      return { handled: textRes.block.trim() ? `←(${textRes.block})` : '←', nextIndex: textRes.nextIndex };
    } else if (command === '\\begin') {
      const envRes = this.parseEnvName(latex, index);
      const contentRes = this.parseEnvironment(latex, envRes.nextIndex, envRes.envName);
      return { handled: this.renderEnvironment(envRes.envName, contentRes.content), nextIndex: contentRes.nextIndex };
    } else if (command === '\\end') {
      const envRes = this.parseEnvName(latex, index);
      return { handled: '', nextIndex: envRes.nextIndex };
    }

    return { handled: command, nextIndex: index };
  }

  private parseCommand(latex: string, start: number): { command: string; nextIndex: number } {
    const match = latex.substring(start).match(/^\\([a-zA-Z]+|.)/);
    if (match) {
      return { command: match[0], nextIndex: start + match[0].length };
    }
    return { command: '\\', nextIndex: start + 1 };
  }

  private parseBlock(latex: string, start: number): { block: string; nextIndex: number } {
    if (start >= latex.length) return { block: '', nextIndex: start };
    if (latex[start] !== '{') {
      if (latex[start] === '\\') {
        const cmdRes = this.parseCommand(latex, start);
        const handleRes = this.handleCommand(cmdRes.command, latex, cmdRes.nextIndex);
        return { block: handleRes.handled, nextIndex: handleRes.nextIndex };
      }
      return { block: latex[start], nextIndex: start + 1 };
    }
    let level = 1;
    let pos = start + 1;
    while (pos < latex.length && level > 0) {
      if (latex[pos] === '{') level++;
      else if (latex[pos] === '}') level--;
      pos++;
    }
    return { block: this.parse(latex.substring(start + 1, pos - 1)), nextIndex: pos };
  }

  private parseOptional(latex: string, start: number): { option: string; nextIndex: number } {
    if (start >= latex.length || latex[start] !== '[') return { option: '', nextIndex: start };
    let level = 1;
    let pos = start + 1;
    while (pos < latex.length && level > 0) {
      if (latex[pos] === '[') level++;
      else if (latex[pos] === ']') level--;
      pos++;
    }
    return { option: this.parse(latex.substring(start + 1, pos - 1)), nextIndex: pos };
  }

  private parseSpaces(latex: string, start: number): { spaces: string; nextIndex: number } {
    let end = start;
    while (end < latex.length && latex[end].trim() === '') end++;
    const substring = latex.substring(start, end);
    return { spaces: substring.includes('\n') ? '\n\n' : ' ', nextIndex: end };
  }

  private parseDelimiter(latex: string, index: number): { delim: string; nextIndex: number } {
    if (index >= latex.length) return { delim: '', nextIndex: index };
    const ch = latex[index];
    if (ch === '\\') {
      const match = latex.substring(index).match(/^\\([a-zA-Z]+|.)/);
      if (match) {
        const cmd = match[0];
        return { delim: LATEX_SYMBOLS[cmd] || cmd.replace(/^\\/, ''), nextIndex: index + match[0].length };
      }
      return { delim: '\\', nextIndex: index + 1 };
    } else if (ch === '.') {
      return { delim: '', nextIndex: index + 1 };
    } else {
      return { delim: ch, nextIndex: index + 1 };
    }
  }

  private parseEnvName(latex: string, index: number): { envName: string; nextIndex: number } {
    if (index < latex.length && latex[index] === '{') {
      const close = latex.indexOf('}', index);
      if (close !== -1) {
        return { envName: latex.substring(index + 1, close), nextIndex: close + 1 };
      }
    }
    return { envName: '', nextIndex: index };
  }

  private parseEnvironment(latex: string, index: number, envName: string): { content: string; nextIndex: number } {
    const endMarker = `\\end{${envName}}`;
    const endPos = latex.indexOf(endMarker, index);
    if (endPos === -1) {
      return { content: latex.substring(index), nextIndex: latex.length };
    }
    return { content: latex.substring(index, endPos), nextIndex: endPos + endMarker.length };
  }

  private renderEnvironment(envName: string, content: string): string {
    const MATRIX_TYPES: Record<string, [string, string]> = {
      matrix: ['', ''],
      pmatrix: ['(', ')'],
      bmatrix: ['[', ']'],
      Bmatrix: ['{', '}'],
      vmatrix: ['|', '|'],
      Vmatrix: ['‖', '‖'],
      smallmatrix: ['', ''],
    };
    const ALIGN_TYPES = new Set([
      'align', 'aligned', 'gather', 'gathered', 'equation', 'equation*',
      'multline', 'multline*', 'split', 'flalign', 'flalign*'
    ]);

    if (envName in MATRIX_TYPES) {
      const [left, right] = MATRIX_TYPES[envName];
      return this.renderMatrix(content, left, right, envName === 'smallmatrix');
    } else if (envName === 'cases') {
      return this.renderCases(content);
    } else if (ALIGN_TYPES.has(envName)) {
      return this.renderAlign(content);
    } else if (envName === 'array') {
      return this.renderArray(content);
    } else {
      return this.parse(content);
    }
  }

  private renderMatrix(content: string, left: string, right: string, compact = false): string {
    const rows = content.split('\\\\').map((r) => r.trim()).filter((r) => r);
    const rendered: string[] = [];
    for (const row of rows) {
      const cells = row.split('&').map((c) => this.parse(c.trim()));
      rendered.push(cells.join(compact ? ', ' : '  '));
    }
    const body = rendered.join(compact ? '; ' : '\n');
    if (left || right) {
      return `${left}${body}${right}`;
    }
    return body;
  }

  private renderCases(content: string): string {
    const rows = content.split('\\\\').map((r) => r.trim()).filter((r) => r);
    const parts: string[] = [];
    for (const row of rows) {
      const segments = row.split('&');
      const val = this.parse(segments[0].trim());
      let cond = '';
      if (segments.length > 1) {
        cond = this.parse(segments.slice(1).join('&').trim());
      }
      parts.push(cond ? `${val}, ${cond}` : val);
    }
    const n = parts.length;
    if (n === 0) return '';
    if (n === 1) return `\u23A7 ${parts[0]}`;
    const lines: string[] = [];
    for (let i = 0; i < n; i++) {
      if (i === 0) lines.push(`\u23A7 ${parts[i]}`);
      else if (i === n - 1) lines.push(`\u23A9 ${parts[i]}`);
      else lines.push(`\u23A8 ${parts[i]}`);
    }
    return lines.join('\n');
  }

  private renderAlign(content: string): string {
    const rows = content.split('\\\\').map((r) => r.trim()).filter((r) => r);
    return rows.map((r) => this.parse(r.replace(/&/g, ' '))).join('\n');
  }

  private renderArray(content: string): string {
    let stripped = content.trimStart();
    if (stripped.startsWith('{')) {
      const close = stripped.indexOf('}');
      if (close !== -1) {
        stripped = stripped.substring(close + 1);
      }
    }
    return this.renderMatrix(stripped, '', '');
  }

  public convert(latex: string): string {
    try {
      return this.parse(latex);
    } catch (e) {
      console.error(`Failed to convert LaTeX to Unicode: ${e}`);
      return latex;
    }
  }
}
