import { describe, it, expect, beforeEach } from 'vitest';
import { LatexToUnicodeHelper } from '../src/latex/helper.js';
import { convert } from '../src/converter.js';

describe('LatexHelperTest', () => {
  let helper: LatexToUnicodeHelper;

  beforeEach(() => {
    helper = new LatexToUnicodeHelper();
  });

  it('superscript latex command', () => {
    const result = helper.convert('\\lambda^\\phi');
    expect(result).toContain('λ');
    expect(result).toContain('ᵠ');
    expect(result).not.toContain('\\phi');
  });

  it('subscript latex command', () => {
    const result = helper.convert('a_\\beta');
    expect(result).toContain('a');
    expect(result).toContain('ᵦ');
    expect(result).not.toContain('\\beta');
  });

  it('superscript with braces', () => {
    const result = helper.convert('x^{2}');
    expect(result).toBe('x²');
  });

  it('superscript frac after command', () => {
    const result = helper.convert('x^\\frac{1}{2}');
    expect(result).toContain('½');
  });

  it('basic symbols', () => {
    const result = helper.convert('\\Delta y');
    expect(result).toContain('Δ');
  });

  it('fraction', () => {
    const result = helper.convert('\\frac{1}{2}');
    expect(result).toBe('½');
  });

  it('sqrt single arg', () => {
    const result = helper.convert('\\sqrt{x}');
    expect(result).toContain('√');
    expect(result).toContain('x');
  });

  it('sqrt with optional index', () => {
    const result = helper.convert('\\sqrt[3]{x}');
    expect(result).toContain('∛');
  });

  it('sqrt preserves following', () => {
    const result = helper.convert('\\sqrt{x} + y');
    expect(result).toContain('+');
    expect(result).toContain('y');
  });

  it('sqrt fourth root', () => {
    const result = helper.convert('\\sqrt[4]{16}');
    expect(result).toContain('∜');
  });

  it('left right parens', () => {
    const result = helper.convert('\\left(x + y\\right)');
    expect(result).toContain('(');
    expect(result).toContain(')');
    expect(result).toContain('x');
  });

  it('left right braces', () => {
    const result = helper.convert('\\left\\{x\\right\\}');
    expect(result).toContain('{');
    expect(result).toContain('}');
  });

  it('left right invisible', () => {
    const result = helper.convert('\\left.x\\right|');
    expect(result).toContain('x');
    expect(result).toContain('|');
  });

  it('not equals', () => {
    const result = helper.convert('\\not=');
    expect(result).toBe('≠');
  });

  it('not in', () => {
    const result = helper.convert('\\not\\in');
    expect(result).toBe('∉');
  });

  it('not subset', () => {
    const result = helper.convert('\\not\\subset');
    expect(result).toBe('⊄');
  });

  it('double backslash', () => {
    const result = helper.convert('a \\\\ b');
    expect(result).toContain('\n');
  });

  it('trig functions', () => {
    const result = helper.convert('\\sin^2\\theta + \\cos^2\\theta = 1');
    expect(result).toContain('sin');
    expect(result).toContain('cos');
    expect(result).toContain('θ');
  });

  it('log ln', () => {
    const result = helper.convert('\\log_2 n = \\frac{\\ln n}{\\ln 2}');
    expect(result).toContain('log');
    expect(result).toContain('ln');
  });

  it('lim', () => {
    const result = helper.convert('\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1');
    expect(result).toContain('lim');
    expect(result).toContain('sin');
  });

  it('layout hints silent', () => {
    const result = helper.convert('\\displaystyle\\sum\\limits_{i=1}^{n} i');
    expect(result).toContain('∑');
    expect(result).not.toContain('displaystyle');
    expect(result).not.toContain('limits');
  });

  it('binom', () => {
    const result = helper.convert('\\binom{n}{k}');
    expect(result).toContain('n');
    expect(result).toContain('k');
  });

  it('operatorname', () => {
    const result = helper.convert('\\operatorname{argmax}_{x}');
    expect(result).toContain('argmax');
  });

  it('mathrm', () => {
    const result = helper.convert('\\mathrm{d}x');
    expect(result).toContain('d');
    expect(result).toContain('x');
  });

  it('boxed', () => {
    const result = helper.convert('\\boxed{E = mc^2}');
    expect(result).toContain('[');
    expect(result).toContain(']');
  });

  it('pmod', () => {
    const result = helper.convert('a \\equiv b \\pmod{p}');
    expect(result).toContain('mod');
    expect(result).toContain('p');
  });
});

describe('LatexConverterTest', () => {
  it('inline latex escape', () => {
    const { text } = convert('\\(\\lambda^\\phi\\)', { latexEscape: true });
    expect(text).toContain('λ');
    expect(text).toContain('ᵠ');
  });

  it('display latex escape', () => {
    const { text } = convert('\\[\\frac{1}{2}\\]', { latexEscape: true });
    expect(text).toContain('½');
  });
});
