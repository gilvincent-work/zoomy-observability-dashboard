import {describe, it, expect} from 'vitest';
import {formatPeso, parsePrice, parseQty, stockLabel, lineLabel} from '../src/pos-format';

describe('formatPeso', () => {
  it('formats amounts with the peso sign and grouping', () => {
    expect(formatPeso(170)).toBe('₱170');
    expect(formatPeso(1250.5)).toBe('₱1,250.5');
  });
  it('renders a dash for null/NaN', () => {
    expect(formatPeso(null)).toBe('—');
    expect(formatPeso(Number.NaN)).toBe('—');
  });
});

describe('parsePrice', () => {
  it('accepts a positive number', () => {
    expect(parsePrice('170')).toEqual({value: 170});
    expect(parsePrice(' 99.50 ')).toEqual({value: 99.5});
  });
  it('rejects empty, non-numeric and non-positive input', () => {
    expect(parsePrice('')).toEqual({error: 'Price is required.'});
    expect(parsePrice('abc')).toEqual({error: 'Enter a valid number.'});
    expect(parsePrice('0')).toEqual({error: 'Price must be greater than zero.'});
    expect(parsePrice('-5')).toEqual({error: 'Price must be greater than zero.'});
  });
});

describe('parseQty', () => {
  it('accepts non-negative integers; empty is 0', () => {
    expect(parseQty('12')).toEqual({value: 12});
    expect(parseQty('0')).toEqual({value: 0});
    expect(parseQty('')).toEqual({value: 0});
    expect(parseQty('  ')).toEqual({value: 0});
  });
  it('rejects negatives and non-integers', () => {
    expect(parseQty('-1')).toEqual({error: 'Stock cannot be negative.'});
    expect(parseQty('3.5')).toEqual({error: 'Enter a whole number.'});
    expect(parseQty('abc')).toEqual({error: 'Enter a whole number.'});
  });
});

describe('stockLabel', () => {
  it('classifies out / low / ok', () => {
    expect(stockLabel(0)).toBe('out');
    expect(stockLabel(-3)).toBe('out');
    expect(stockLabel(10)).toBe('low');
    expect(stockLabel(11)).toBe('ok');
  });
});

describe('lineLabel', () => {
  it('maps known line codes and passes through unknown', () => {
    expect(lineLabel('FDR')).toBe('Freeze-Dried');
    expect(lineLabel('JRK')).toBe('Jerky');
    expect(lineLabel('MEAT')).toBe('Meaty');
    expect(lineLabel('XYZ')).toBe('XYZ');
  });
});
