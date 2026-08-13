// Test fixture: must be imported FIRST by any safe-mutation test that needs
// an isolated DATA_DIR. ESM imports are hoisted, so importing this module
// before `@/lib/*` ensures process.env.DATA_DIR is set before lib/data-dir.ts
// captures it at module-load time.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomBytes } from 'crypto';

export const TEST_DATA_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), `safe-mutation-fixture-${randomBytes(4).toString('hex')}-`),
);
process.env.DATA_DIR = TEST_DATA_DIR;
