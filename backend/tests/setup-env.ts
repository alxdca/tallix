import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(here, '../../.env') });
config({ path: resolve(here, '../.env') });
