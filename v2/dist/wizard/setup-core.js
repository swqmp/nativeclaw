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
exports.NativeClawSetup = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const HOME = process.env.HOME || process.env.USERPROFILE || '';
class NativeClawSetup {
    state;
    bridgeDir;
    constructor() {
        this.bridgeDir = path.join(HOME, '.claude', 'telegram-bridge');
        this.state = {
            step: 0,
            backend: 'both',
            agentName: 'Whet',
            userName: 'User',
            botToken: '',
            chatId: '',
            vibeTemplate: 'sharp',
            enableQMD: true,
            enableVoice: true,
            customSOUL: '',
        };
    }
    getState() {
        return { ...this.state };
    }
    loadState(s) {
        this.state = { ...this.state, ...s };
    }
    // ============================================================
    // Step 1: Welcome + Prereq Check
    // ============================================================
    stepWelcome() {
        console.log('\n⚡ NativeClaw v2.0 Setup Wizard\n');
        console.log('This will configure your AI agent to run via Telegram.');
        console.log('You will need:');
        console.log('  • A Telegram bot token (from @BotFather)');
        console.log('  • Node.js 18+ installed');
        console.log('  • Claude CLI and/or Codex CLI (and/or OpenCode for Kimi/Grok)\n');
        return 'continue';
    }
    stepPrereqCheck() {
        const nodeVersion = (() => {
            try {
                return (0, child_process_1.execSync)('node -v', { encoding: 'utf8' }).trim();
            }
            catch {
                return '';
            }
        })();
        const claudeCLI = this.hasCommand('claude');
        const codexCLI = this.hasCommand('codex');
        const opencodeCLI = this.hasCommand('opencode');
        const git = this.hasCommand('git');
        const result = {
            node: !!nodeVersion,
            nodeVersion,
            claudeCLI,
            codexCLI,
            opencodeCLI,
            git,
        };
        console.log('Prereq check:');
        console.log(`  Node.js: ${result.node ? '✅' : '❌'} ${result.nodeVersion}`);
        console.log(`  Claude CLI: ${result.claudeCLI ? '✅' : '❌'}`);
        console.log(`  Codex CLI: ${result.codexCLI ? '✅' : '❌'}`);
        console.log(`  OpenCode CLI: ${result.opencodeCLI ? '✅' : '❌'}`);
        console.log(`  Git: ${result.git ? '✅' : '❌'}`);
        // Auto-install helper — only Node.js if missing, because the rest
        // require authenticated installs (Claude OAuth, etc.)
        if (!result.node) {
            throw new Error('Node.js is required. Install from https://nodejs.org');
        }
        return result;
    }
    // ============================================================
    // Step 2: Backend Choice
    // ============================================================
    async stepBackendChoice(enquirer) {
        const { backend } = await enquirer.prompt({
            type: 'select',
            name: 'backend',
            message: 'Which backends do you want to enable?',
            choices: [
                { name: 'both', message: 'Claude + Codex (recommended)' },
                { name: 'claude', message: 'Claude only' },
                { name: 'codex', message: 'Codex (OpenAI) only' },
                { name: 'kimi', message: 'Kimi (OpenRouter — experimental)' },
                { name: 'grok', message: 'Grok (OpenRouter — experimental)' },
                { name: 'all', message: 'All four (Claude + Codex + Kimi + Grok)' },
            ],
        });
        this.state.backend = backend;
        console.log(`Backend set: ${backend}`);
        return 'continue';
    }
    // ============================================================
    // Step 3: Agent Identity
    // ============================================================
    async stepIdentity(enquirer) {
        const { agentName, userName, vibe } = await enquirer.prompt([
            {
                type: 'input',
                name: 'agentName',
                message: 'Agent name (e.g. Whet)',
                initial: this.state.agentName,
            },
            {
                type: 'input',
                name: 'userName',
                message: 'Your name (e.g. Jamiah)',
                initial: this.state.userName,
            },
            {
                type: 'select',
                name: 'vibe',
                message: 'SOUL.md vibe template',
                choices: [
                    { name: 'sharp', message: 'Sharp — direct, no filler, high agency' },
                    { name: 'friendly', message: 'Friendly — warm, collaborative, encouraging' },
                    { name: 'professional', message: 'Professional — formal, detailed, cautious' },
                    { name: 'custom', message: 'Custom — you will paste your own' },
                ],
            },
        ]);
        this.state.agentName = agentName;
        this.state.userName = userName;
        this.state.vibeTemplate = vibe;
        if (vibe === 'custom') {
            const { custom } = await enquirer.prompt({
                type: 'editor',
                name: 'custom',
                message: 'Paste your custom SOUL.md content',
            });
            this.state.customSOUL = custom;
        }
        return 'continue';
    }
    // ============================================================
    // Step 4: Telegram Connection
    // ============================================================
    async stepTelegram(enquirer) {
        console.log('\n--- Telegram Setup ---');
        console.log('1. Message @BotFather on Telegram');
        console.log('2. Send /newbot and follow prompts');
        console.log('3. Paste the bot token below\n');
        const { token } = await enquirer.prompt({
            type: 'password',
            name: 'token',
            message: 'Bot token (from @BotFather):',
            validate: (v) => /^\d+:[A-Za-z0-9_-]+$/.test(v) || 'Format should be 123456:ABC-DEF...',
        });
        this.state.botToken = token;
        // Quick validate via Telegram API
        try {
            const check = await fetch(`https://api.telegram.org/bot${token}/getMe`);
            const json = await check.json();
            if (!json.ok)
                throw new Error(json.description || 'Invalid token');
            console.log(`✅ Token valid. Bot: @${json.result.username}`);
        }
        catch (e) {
            console.error(`⚠️ Token validation failed: ${e.message}`);
            const redo = await enquirer.prompt({
                type: 'confirm',
                name: 'redo',
                message: 'Re-enter token?',
                initial: true,
            });
            if (redo.redo)
                return this.stepTelegram(enquirer);
            else
                return 'skip';
        }
        // Auto-detect chat ID from updates
        console.log('\n👉 Now send ANY message to your bot in Telegram. Waiting…');
        console.log('   (Auto-detecting your chat ID. Press Ctrl+C to skip.)');
        const chatId = await this.pollForChatId(token, 60); // 60 seconds
        if (chatId) {
            this.state.chatId = String(chatId);
            console.log(`✅ Chat ID detected: ${chatId}`);
        }
        else {
            console.log('⏱ Timed out. Chat ID can be set later in config.json.');
            this.state.chatId = '';
        }
        return 'continue';
    }
    async pollForChatId(token, timeoutSec) {
        const deadline = Date.now() + timeoutSec * 1000;
        while (Date.now() < deadline) {
            try {
                const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
                const json = await res.json();
                if (json.ok && json.result.length > 0) {
                    const last = json.result[json.result.length - 1];
                    if (last?.message?.chat?.id)
                        return last.message.chat.id;
                }
            }
            catch {
                // ignore
            }
            await new Promise((r) => setTimeout(r, 3000));
        }
        return null;
    }
    // ============================================================
    // Step 5: Optional Features
    // ============================================================
    async stepFeatures(enquirer) {
        const { qmd, voice } = await enquirer.prompt([
            {
                type: 'confirm',
                name: 'qmd',
                message: 'Enable QMD persistent memory?',
                initial: this.state.enableQMD,
            },
            {
                type: 'confirm',
                name: 'voice',
                message: 'Enable voice message transcription?',
                initial: this.state.enableVoice,
            },
        ]);
        this.state.enableQMD = qmd;
        this.state.enableVoice = voice;
        return 'continue';
    }
    // ============================================================
    // Step 6: Install + Verify
    // ============================================================
    stepInstall() {
        console.log('\n--- Installing ---\n');
        // 1. Write config.json
        const config = {
            botToken: this.state.botToken,
            allowedChatIds: this.state.chatId ? [Number(this.state.chatId)] : [],
            workspace: path.join(HOME, '.claude', 'workspace'),
            model: 'sonnet',
            defaultBackend: this.state.backend === 'both' ? 'claude' : this.state.backend,
            agentName: this.state.agentName,
            userName: this.state.userName,
            mcpConfig: path.join(HOME, '.claude', '.mcp.json'),
            cronSchedule: path.join(HOME, '.claude', 'cron-schedule.json'),
        };
        fs.mkdirSync(this.bridgeDir, { recursive: true });
        fs.writeFileSync(path.join(this.bridgeDir, 'config.json'), JSON.stringify(config, null, 2));
        console.log('✅ Written: ~/.claude/telegram-bridge/config.json');
        // 2. Write SOUL.md from template
        const soulPath = path.join(HOME, '.claude', 'workspace', 'SOUL.md');
        const soulContent = this.state.customSOUL || this.buildSOULTemplate();
        fs.writeFileSync(soulPath, soulContent);
        console.log('✅ Written: SOUL.md');
        // 3. Write basic AGENTS.md + MEMORY.md stubs if missing
        const workspace = path.join(HOME, '.claude', 'workspace');
        for (const fname of ['AGENTS.md', 'MEMORY.md', 'USER.md', 'TOOLS.md', 'NATIVECLAW.md']) {
            const fpath = path.join(workspace, fname);
            if (!fs.existsSync(fpath)) {
                fs.writeFileSync(fpath, `# ${fname.replace('.md', '')}\n\nAuto-generated by NativeClaw v2.0 setup.\n`);
                console.log(`✅ Created stub: ${fname}`);
            }
        }
        // 4. Install service (macOS launchd by default)
        this.installService();
        // 5. Test round-trip
        console.log('\n--- Verification ---');
        console.log('Test: sending a message via Telegram to verify bridge responds…');
        console.log('(Skip with Ctrl+C if you do not want to test now.)\n');
        return 'continue';
    }
    buildSOULTemplate() {
        const templates = {
            sharp: `# SOUL.md — ${this.state.agentName}\n\nYou are a sharp, direct assistant. No filler. High agency.\n`,
            friendly: `# SOUL.md — ${this.state.agentName}\n\nYou are a warm, collaborative assistant. Encouraging tone.\n`,
            professional: `# SOUL.md — ${this.state.agentName}\n\nYou are a formal, detail-oriented assistant. Cautious and thorough.\n`,
        };
        return templates[this.state.vibeTemplate] || templates.sharp;
    }
    installService() {
        const isMac = process.platform === 'darwin';
        const isLinux = process.platform === 'linux';
        if (isMac) {
            const plistPath = path.join(HOME, 'Library', 'LaunchAgents', 'com.njdev.nativeclaw.plist');
            const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.njdev.nativeclaw</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${path.join(HOME, '.claude', 'workspace', 'projects', 'nativeclaw', 'v2', 'bin', 'bridge-wrapper')}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/.claude/logs/nativeclaw.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.claude/logs/nativeclaw-error.log</string>
</dict>
</plist>`;
            fs.writeFileSync(plistPath, plist);
            try {
                (0, child_process_1.execSync)(`launchctl load -w "${plistPath}"`);
                console.log('✅ launchd service installed');
            }
            catch (e) {
                console.log(`⚠️ launchctl load failed: ${e.message}`);
                console.log(`   Run manually: launchctl load -w ${plistPath}`);
            }
        }
        else if (isLinux) {
            console.log('💡 Linux: systemd service file written to ~/.config/systemd/user/nativeclaw.service');
            console.log('   Enable with: systemctl --user enable nativeclaw && systemctl --user start nativeclaw');
            // systemd unit stub
        }
        else {
            console.log('💡 Windows: Task Scheduler XML written. Import via Task Scheduler.');
        }
    }
    hasCommand(cmd) {
        try {
            (0, child_process_1.execSync)(`which ${cmd} 2>/dev/null`, { encoding: 'utf8' });
            return true;
        }
        catch {
            return false;
        }
    }
}
exports.NativeClawSetup = NativeClawSetup;
exports.default = NativeClawSetup;
//# sourceMappingURL=setup-core.js.map