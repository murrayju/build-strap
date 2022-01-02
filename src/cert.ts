import fs from 'fs-extra';
import fetch from 'node-fetch';
import os from 'os';
import path from 'path';

import { spawn } from './cp.js';
import { readDir } from './fs.js';
import { getCfg } from './pkg.js';
import { buildLog } from './run.js';

export interface CertConfig {
  commonName?: string;
  countryName?: string;
  emailAddress?: string;
  localityName?: string;
  organizationName?: string;
  organizationalUnitName?: string;
  stateOrProvinceName?: string;
}

export const getCertConfig = (): CertConfig => getCfg().cert ?? {};

export const getIpAddresses = (): string[] =>
  Object.values(os.networkInterfaces()).flatMap(
    (iFaces) => iFaces?.map((iFace) => iFace.address) ?? [],
  );

interface IfConfig {
  hostname: string;
  ip: string;
}

// Generate a self-signed certificate (if it doesn't exist)
export async function generateCert(
  targetDir: string,
  force: boolean = process.argv.includes('--force-generateCert'),
) {
  if (process.argv.includes('--no-generateCert')) {
    buildLog('Skipping due to --no-generateCert');
    return;
  }
  buildLog(`scanning ${targetDir} for certificates...`);
  if (
    !force &&
    (await readDir(`${targetDir}/server.@(crt|key)`)).length === 2
  ) {
    buildLog('Skipping certificate generation: certificate already exists');
    return;
  }
  buildLog('Generating self-signed certificate...');
  const {
    commonName = 'app.company.com',
    countryName = 'US',
    emailAddress = 'contact@company.com',
    localityName = 'SomeCity',
    organizationName = 'Company',
    organizationalUnitName = 'Product',
    stateOrProvinceName = 'Pennsylvania',
  } = getCertConfig();
  const hostname = os.hostname();
  buildLog(`hostname: ${hostname}`);
  const ipAddresses = getIpAddresses();
  buildLog(`ip addresses: ${JSON.stringify(ipAddresses)}`);
  const ifconfig = await fetch('https://ifconfig.co').then(
    (r) => r.json() as Promise<IfConfig>,
  );
  const externalIp4 = ifconfig.ip;
  buildLog(`external ipv4: ${externalIp4}`);
  const dnsName = ifconfig.hostname;
  buildLog(`dnsName: ${dnsName}`);

  await fs.ensureDir(targetDir);
  const keyFile = path.resolve(targetDir, 'server.key');
  const csrFile = path.resolve(targetDir, 'server.csr');
  const crtFile = path.resolve(targetDir, 'server.crt');
  const confTemplateFile = path.resolve(__dirname, 'cert.conf');
  const confFile = path.resolve(targetDir, 'cert.conf.generated');
  const confTemplate = await fs.readFile(confTemplateFile, 'utf8');
  await fs.writeFile(
    confFile,
    confTemplate
      .replace('{{countryName}}', countryName)
      .replace('{{stateOrProvinceName}}', stateOrProvinceName)
      .replace('{{localityName}}', localityName)
      .replace('{{organizationName}}', organizationName)
      .replace('{{organizationalUnitName}}', organizationalUnitName)
      .replace('{{commonName}}', commonName)
      .replace('{{emailAddress}}', emailAddress)
      .replace(
        '{{SAN_IP}}',
        ipAddresses.reduce((acc, next) => `${acc},IP:${next}`, ''),
      )
      .replace('{{SAN_DNS}}', `,DNS:${hostname},DNS:${dnsName}`),
    'utf8',
  );

  buildLog('generating key file...');
  await spawn(
    'openssl',
    [
      'genpkey',
      '-algorithm',
      'RSA',
      '-pkeyopt',
      'rsa_keygen_bits:2048',
      '-out',
      keyFile,
    ],
    { pipeOutput: true },
  );
  buildLog('generating csr file...');
  await spawn(
    'openssl',
    [
      'req',
      '-new',
      '-key',
      keyFile,
      '-out',
      csrFile,
      '-subj',
      `/C=${countryName}/ST=${stateOrProvinceName}/L=${localityName}/O=${organizationName}/OU=${organizationalUnitName}/CN=${commonName}/CN=${externalIp4}/CN=${hostname}/CN=${dnsName}${ipAddresses.reduce(
        (acc, next) => `${acc}/CN=${next}`,
      )}/CN=localhost`,
      '-config',
      confFile,
    ],
    { pipeOutput: true },
  );
  buildLog('generating cert...');
  await spawn(
    'openssl',
    [
      'x509',
      '-req',
      '-days',
      '365',
      '-in',
      csrFile,
      '-signkey',
      keyFile,
      '-out',
      crtFile,
      '-extfile',
      confFile,
      '-extensions',
      'v3_req',
    ],
    { pipeOutput: true },
  );
}
