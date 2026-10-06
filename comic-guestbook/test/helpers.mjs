import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ART = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'art');

export const loadCharacter = (id) => JSON.parse(fs.readFileSync(path.join(ART, 'characters', `${id}.json`), 'utf8'));
export const loadIndex = () => JSON.parse(fs.readFileSync(path.join(ART, 'index.json'), 'utf8'));
