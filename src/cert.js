// @flow
import os from 'os';
import rp from 'request-promise-native';
import path from 'path';
import fs from 'fs-extra';
import { buildLog } from './run';
import { readDir } from './fs';
import { spawn } from './cp';
import { getCfg } from './pkg';

export type CertConfig = {
  countryName?: string,
  stateOrProvinceName?: string,
  localityName?: string,
  organizationName?: string,
  organizationalUnitName?: string,
  commonName?: string,
  emailAddress?: string,
};

export function getCertConfig(): CertConfig {
  return getCfg().cert || {};
}

export function getIpAddresses() {
  const iFaces = os.networkInterfaces();
  return Object.keys(iFaces).reduce(
    (prev, ifName) => [...prev, ...iFaces[ifName].map(iFace => iFace.address)],
    [],
  );
}

// Generate a self-signed certificate (if it doesn't exist)
export async function generateCert(
  targetDir: string = './build/config',
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
    countryName = 'US',
    stateOrProvinceName = 'Pennsylvania',
    localityName = 'SomeCity',
    organizationName = 'Company',
    organizationalUnitName = 'Product',
    commonName = 'app.company.com',
    emailAddress = 'contact@company.com',
  } = getCertConfig();
  const hostname = os.hostname();
  buildLog(`hostname: ${hostname}`);
  const ipAddresses = getIpAddresses();
  buildLog(`ip addresses: ${JSON.stringify(ipAddresses)}`);
  const ifconfig = await rp.get('https://ifconfig.co', { json: true });
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
    null,
    true,
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
    null,
    true,
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
    null,
    true,
  );
}
