"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCredentials = getCredentials;
const child_process_1 = require("child_process");
const os = __importStar(require("os"));
class DarwinCredentials {
    read(service, account) {
        try {
            return (0, child_process_1.execSync)(`/usr/bin/security find-generic-password -a ${JSON.stringify(account)} -s ${JSON.stringify(service)} -w 2>/dev/null`, { encoding: 'utf8' }).trim();
        }
        catch {
            return null;
        }
    }
    write(service, account, secret) {
        // add or update
        try {
            (0, child_process_1.execSync)(`/usr/bin/security add-generic-password -a ${JSON.stringify(account)} -s ${JSON.stringify(service)} -w ${JSON.stringify(secret)} -U`, { encoding: 'utf8' });
        }
        catch (e) {
            throw new Error(`Keychain write failed: ${e.message}`);
        }
    }
    delete(service, account) {
        try {
            (0, child_process_1.execSync)(`/usr/bin/security delete-generic-password -a ${JSON.stringify(account)} -s ${JSON.stringify(service)}`, { encoding: 'utf8' });
        }
        catch {
            // ignore not-found
        }
    }
}
class LinuxCredentials {
    passDir;
    constructor() {
        this.passDir = `${process.env.HOME}/.nativeclaw-credentials`;
    }
    read(service, account) {
        // Prefer secret-tool if available
        try {
            return (0, child_process_1.execSync)(`secret-tool lookup service ${JSON.stringify(service)} account ${JSON.stringify(account)} 2>/dev/null`, { encoding: 'utf8' }).trim();
        }
        catch {
            // Fallback: simple file store
            try {
                const p = `${this.passDir}/${service}-${account}`;
                return require('fs').readFileSync(p, 'utf8').trim();
            }
            catch {
                return null;
            }
        }
    }
    write(service, account, secret) {
        try {
            (0, child_process_1.execSync)(`secret-tool store --label="${service}" service ${JSON.stringify(service)} account ${JSON.stringify(account)}`, { encoding: 'utf8', input: secret });
        }
        catch {
            // Fallback: simple file store
            const fs = require('fs');
            const path = require('path');
            fs.mkdirSync(this.passDir, { recursive: true, mode: 0o700 });
            const p = `${this.passDir}/${service}-${account}`;
            fs.writeFileSync(p, secret, { mode: 0o600 });
        }
    }
    delete(service, account) {
        try {
            (0, child_process_1.execSync)(`secret-tool clear service ${JSON.stringify(service)} account ${JSON.stringify(account)}`, { encoding: 'utf8' });
        }
        catch {
            /* ignore */
        }
        try {
            const fs = require('fs');
            fs.unlinkSync(`${this.passDir}/${service}-${account}`);
        }
        catch {
            /* ignore */
        }
    }
}
class WindowsCredentials {
    read(service, account) {
        try {
            const out = (0, child_process_1.execSync)(`powershell -Command "(New-Object -TypeName System.Management.Automation.PSCredential -ArgumentList '${account}', (Get-StoredCredential -Target '${service}').Password).GetNetworkCredential().Password"`, { encoding: 'utf8' }).trim();
            return out || null;
        }
        catch {
            return null;
        }
    }
    write(service, account, secret) {
        try {
            (0, child_process_1.execSync)(`cmdkey /generic:${service} /user:${account} /pass:${secret}`, { encoding: 'utf8' });
        }
        catch (e) {
            throw new Error(`Credential store write failed: ${e.message}`);
        }
    }
    delete(service, account) {
        try {
            (0, child_process_1.execSync)(`cmdkey /delete:${service}`, { encoding: 'utf8' });
        }
        catch {
            /* ignore */
        }
    }
}
function getCredentials() {
    const platform = os.platform();
    if (platform === 'darwin')
        return new DarwinCredentials();
    if (platform === 'linux')
        return new LinuxCredentials();
    if (platform === 'win32')
        return new WindowsCredentials();
    // Default to file-based fallback
    return new LinuxCredentials();
}
exports.default = getCredentials;
//# sourceMappingURL=credentials.js.map