import { execSync } from 'child_process';
import * as os from 'os';

/**
 * Cross-platform keychain / credential store abstraction.
 * macOS:  security(1) Keychain
 * Linux:  secret-tool (libsecret) or fallback to pass-store file
 * Windows: PowerShell CredentialManager or cmdkey fallback
 */

export interface Credentials {
  read(service: string, account: string): string | null;
  write(service: string, account: string, secret: string): void;
  delete(service: string, account: string): void;
}

class DarwinCredentials implements Credentials {
  read(service: string, account: string): string | null {
    try {
      return execSync(
        `/usr/bin/security find-generic-password -a ${JSON.stringify(account)} -s ${JSON.stringify(service)} -w 2>/dev/null`,
        { encoding: 'utf8' }
      ).trim();
    } catch {
      return null;
    }
  }

  write(service: string, account: string, secret: string): void {
    // add or update
    try {
      execSync(
        `/usr/bin/security add-generic-password -a ${JSON.stringify(account)} -s ${JSON.stringify(service)} -w ${JSON.stringify(secret)} -U`,
        { encoding: 'utf8' }
      );
    } catch (e: any) {
      throw new Error(`Keychain write failed: ${e.message}`);
    }
  }

  delete(service: string, account: string): void {
    try {
      execSync(
        `/usr/bin/security delete-generic-password -a ${JSON.stringify(account)} -s ${JSON.stringify(service)}`,
        { encoding: 'utf8' }
      );
    } catch {
      // ignore not-found
    }
  }
}

class LinuxCredentials implements Credentials {
  private passDir: string;
  constructor() {
    this.passDir = `${process.env.HOME}/.nativeclaw-credentials`;
  }

  read(service: string, account: string): string | null {
    // Prefer secret-tool if available
    try {
      return execSync(
        `secret-tool lookup service ${JSON.stringify(service)} account ${JSON.stringify(account)} 2>/dev/null`,
        { encoding: 'utf8' }
      ).trim();
    } catch {
      // Fallback: simple file store
      try {
        const p = `${this.passDir}/${service}-${account}`;
        return require('fs').readFileSync(p, 'utf8').trim();
      } catch {
        return null;
      }
    }
  }

  write(service: string, account: string, secret: string): void {
    try {
      execSync(
        `secret-tool store --label="${service}" service ${JSON.stringify(service)} account ${JSON.stringify(account)}`,
        { encoding: 'utf8', input: secret }
      );
    } catch {
      // Fallback: simple file store
      const fs = require('fs');
      const path = require('path');
      fs.mkdirSync(this.passDir, { recursive: true, mode: 0o700 });
      const p = `${this.passDir}/${service}-${account}`;
      fs.writeFileSync(p, secret, { mode: 0o600 });
    }
  }

  delete(service: string, account: string): void {
    try {
      execSync(
        `secret-tool clear service ${JSON.stringify(service)} account ${JSON.stringify(account)}`,
        { encoding: 'utf8' }
      );
    } catch {
      /* ignore */
    }
    try {
      const fs = require('fs');
      fs.unlinkSync(`${this.passDir}/${service}-${account}`);
    } catch {
      /* ignore */
    }
  }
}

class WindowsCredentials implements Credentials {
  read(service: string, account: string): string | null {
    try {
      const out = execSync(
        `powershell -Command "(New-Object -TypeName System.Management.Automation.PSCredential -ArgumentList '${account}', (Get-StoredCredential -Target '${service}').Password).GetNetworkCredential().Password"`,
        { encoding: 'utf8' }
      ).trim();
      return out || null;
    } catch {
      return null;
    }
  }

  write(service: string, account: string, secret: string): void {
    try {
      execSync(
        `cmdkey /generic:${service} /user:${account} /pass:${secret}`,
        { encoding: 'utf8' }
      );
    } catch (e: any) {
      throw new Error(`Credential store write failed: ${e.message}`);
    }
  }

  delete(service: string, account: string): void {
    try {
      execSync(`cmdkey /delete:${service}`, { encoding: 'utf8' });
    } catch {
      /* ignore */
    }
  }
}

export function getCredentials(): Credentials {
  const platform = os.platform();
  if (platform === 'darwin') return new DarwinCredentials();
  if (platform === 'linux') return new LinuxCredentials();
  if (platform === 'win32') return new WindowsCredentials();
  // Default to file-based fallback
  return new LinuxCredentials();
}

export default getCredentials;
