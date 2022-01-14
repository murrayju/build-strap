import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { spawn } from './cp.js';
import { buildLog } from './run.js';

export const ensureSshKeyGenerated = async (
  keyPath?: string,
): Promise<string> => {
  const sshKeyPath = keyPath || path.join(os.homedir(), '.ssh', 'id_ed25519');
  if (!(await fs.pathExists(sshKeyPath))) {
    buildLog('Generating SSH key (passphrase is optional)...');
    await spawn('ssh-keygen', ['-t', 'ed25519', '-f', sshKeyPath]);
  }
  return sshKeyPath;
};
