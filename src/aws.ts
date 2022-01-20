import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { spawn, SpawnOptions } from './cp.js';
import { buildLog } from './run.js';

export const aws = async (args: string[], options?: SpawnOptions) =>
  spawn('aws', args, options);

export const ensureAwsCredentialsSet = async (message?: string) => {
  if (!(await fs.pathExists(path.join(os.homedir(), '.aws', 'credentials')))) {
    buildLog(
      `AWS credentials not found, let's set those up.
${message || ''}
Navigate to https://console.aws.amazon.com/iam/home#/users
Click on your account name from the list
Click on the "Security credentials" tab
In the "Access keys" section, click on the "Create access key" button
A modal will appear, copy the credentials and paste them below:
`,
    );
    await aws(['configure'], { stdio: 'inherit' });
  }
};

export const chamber = async (args: string[], options?: SpawnOptions) =>
  spawn('chamber', args, options);

export const chamberRead = async (
  target: string,
  varName: string,
): Promise<string> =>
  (
    await chamber(['read', target, varName, '--quiet'], {
      captureOutput: true,
    })
  ).output.trim();
