import { Converter } from 'opencc-js/t2cn';

const convert = Converter({ from: 't', to: 'cn' });
// Use only for system labels and official catalog metadata. User text, names,
// identifiers and signed package contents remain untouched.
export function systemText(value: string): string {
  return convert(value);
}
