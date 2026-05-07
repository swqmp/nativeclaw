/**
 * Web-facing setup wizard server.
 * Same underlying setup-core.ts as the terminal TUI, but with HTML/JSON routes.
 */
export declare class WizardServer {
    private setup;
    private server;
    constructor();
    start(port?: number): void;
    private handleRoute;
    private serveWizardHTML;
    private writeSSE;
    private streamPrereq;
    private streamInstall;
    private storeKeychain;
    private handleSaveStep;
    private handleValidateToken;
    private handlePollChatId;
    private handleTestXaiKey;
}
export default WizardServer;
//# sourceMappingURL=server.d.ts.map