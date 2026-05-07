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
export declare function getCredentials(): Credentials;
export default getCredentials;
//# sourceMappingURL=credentials.d.ts.map