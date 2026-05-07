├── bin/
│   ├── nativeclaw          # Main CLI dispatcher
│   ├── setup               # Terminal setup wizard
│   ├── settings            # Localhost settings UI server
│   ├── backup              # Backup/restore commands
│   ├── doctor              # Diagnostic dump
│   ├── status              # Bridge health snapshot
│   └── bridge-wrapper      # Managed bridge runner (restart on crash)
├── lib/
│   ├── compaction.ts        # Context-window compaction module
│   ├── skills-extractor.ts # Auto-extract reusable skills
│   ├── subagent-delegation.ts # Background agent spawning
│   ├── voice-handler.ts   # Groq/OpenAI/local transcription
│   ├── credentials.ts     # Cross-platform keychain abstraction
│   └── bridge-checkpoint.ts # Bridge-side checkpoint visibility
├── wizard/
│   ├── setup-core.ts       # Shared setup logic (web + terminal)
│   └── server.ts           # Web-facing wizard HTTP server
├── install/
│   ├── install.sh          # macOS/Linux one-liner
│   └── install.ps1         # Windows PowerShell one-liner
├── windows/
│   └── nativeclaw-task.xml # Task Scheduler definition
├── static/
│   ├── default-config.json       # Bridge config skeleton
│   ├── default-mcp-config.json # MCP servers skeleton
│   └── default-cron-schedule.json # Default crons
├── scripts/
│   └── watch.js            # TypeScript watcher
├── index.ts                # Barrel export
├── package.json
├── tsconfig.json
├── README.md
├── CHANGELOG.md
└── VERSION
