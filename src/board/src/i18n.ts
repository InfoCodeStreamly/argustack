import type { DictionaryResult } from './types/dictionary.types.js';
import boardEn from '../dictionaries/en/board.json';
import commonEn from '../dictionaries/en/common.json';

const dictionaries: Record<string, DictionaryResult> = {
  en: {
    board: boardEn.board,
    common: commonEn.common,
  },
};

export function getDictionary(locale = 'en'): DictionaryResult {
  return dictionaries[locale] ?? dictionaries['en']!;
}
