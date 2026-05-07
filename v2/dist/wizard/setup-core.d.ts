interface WizardState {
    step: number;
    backend: 'claude' | 'codex' | 'both' | 'kimi' | 'grok';
    agentName: string;
    userName: string;
    botToken: string;
    chatId: string;
    vibeTemplate: 'sharp' | 'friendly' | 'professional' | 'custom';
    enableQMD: boolean;
    enableVoice: boolean;
    customSOUL: string;
}
interface PrereqCheck {
    node: boolean;
    nodeVersion: string;
    claudeCLI: boolean;
    codexCLI: boolean;
    opencodeCLI: boolean;
    homebrew?: boolean;
    git: boolean;
}
export declare class NativeClawSetup {
    private state;
    private bridgeDir;
    constructor();
    getState(): WizardState;
    loadState(s: Partial<WizardState>): void;
    stepWelcome(): string;
    stepPrereqCheck(): PrereqCheck;
    stepBackendChoice(enquirer: any): Promise<string>;
    stepIdentity(enquirer: any): Promise<string>;
    stepTelegram(enquirer: any): Promise<string>;
    private pollForChatId;
    stepFeatures(enquirer: any): Promise<string>;
    stepInstall(): string;
    private buildSOULTemplate;
    private installService;
    private hasCommand;
}
export default NativeClawSetup;
//# sourceMappingURL=setup-core.d.ts.map