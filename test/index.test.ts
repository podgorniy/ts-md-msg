import { describe, it, expect } from 'vitest';
import { md } from '../src/index.js';

describe('native bindings', () => {
  it('should render basic markdown to html', () => {
    const html = md.renderHtml('# Hello World', undefined);
    expect(html.trim()).toBe('<h1>Hello World</h1>');
  });

  it('should parse basic markdown to AST events', () => {
    const astJson = md.parse('# Hello', undefined);
    const events = JSON.parse(astJson);
    
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
  });
});
