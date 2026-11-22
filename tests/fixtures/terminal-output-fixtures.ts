/**
 * Captured output fixtures for testing terminal output at narrow widths,
 * non-TTY streams, long paths, Unicode text, and remediation commands (SW-126).
 */

export const TERMINAL_FIXTURES = {
  narrowWidthColumns: 40,

  diagnosticReport: {
    pass: '[PASS] Node.js: Supported version 22.13.0 detected.',
    warn: '[WARN] Docker: Docker daemon is unavailable and container workflows cannot run.',
    remediation:
      '  Remediation: Start Docker Desktop or daemon service only when a container-based workflow is needed.',
    stellarWarn:
      '[WARN] Stellar CLI: Stellar CLI version 21.0.0 detected, but version >=22.0.0 is recommended.',
    stellarRemediation:
      '  Remediation: Run `stellar version --only-version` and update via https://stellar.org/docs/tools/stellar-cli.',
    summary: 'Summary: 1 passed, 2 warnings, 0 failed.',
    health: 'Overall health: usable with warnings.',
  },

  longPaths: {
    posix:
      '/Users/developer/stellarforge/workspace/deeply/nested/contracts/soroban_token/src/lib.rs',
    windows:
      'C:\\Users\\Developer\\AppData\\Local\\Temp\\stellarforge-test-run\\contracts\\token\\src\\lib.rs',
    configPath:
      '/etc/stellarforge/production/network-configuration/stellarforge.config.json',
  },

  commands: {
    newCommand: '`stellarforge new my-project --template smart-contract`',
    installCommand: '`npm install --save-dev @stellar/stellar-sdk`',
    deployCommand:
      '`stellar contract deploy --wasm target/wasm32-unknown-unknown/release/token.wasm --network testnet`',
  },

  stellarIdentifiers: {
    contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    accountId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  },

  unicode: {
    emojiMessage:
      '🚀 Deploying contract to Stellar Testnet with verification key ✨ and toolchain 🛠️.',
    zwjEmojiMessage:
      '👨‍💻 Developer workspace configuration updated for user 👍🏽.',
    cjkMessage:
      '[PASS] 环境检查: 所有的依赖项均已满足，可以安全地开始构建 Stellar 智能合约。',
    combiningMarks: 'cafe\u0301 re\u0301sume\u0301 fac\u0327ade na\u0308ive',
    mixedMultilingual:
      'StellarForge CLI: Ελληνικά, Русский, العربية, עברית, 日本語, 한국어, 中文.',
  },

  escapeSequences: {
    ansiColors:
      '\u001b[1m\u001b[32m[PASS]\u001b[0m \u001b[36mGit\u001b[0m: git version 2.45.0 detected.\u001b[0m',
    csiCursorMovement:
      'line 1\u001b[2A\u001b[10Cline updated\u001b[2K\u001b[s\u001b[u',
    cursorVisibility: '\u001b[?25lRunning task...\u001b[?25h',
    oscTitle:
      '\u001b]0;StellarForge CLI Window\u0007Command execution in progress',
    oscTitleEsc:
      '\u001b]0;StellarForge CLI Window\u001b\\Command execution in progress',
    decCursor: '\u001b7Saved position\u001b8Restored position',
  },

  bidiControls: {
    deceptiveFilename: 'report.\u202etxt.exe',
    sanitizedFilename: 'report.txt.exe',
    mixedDirectionCommand: 'Command \u202etarget\u202c executed for العربية and עברית',
    controlCharacters: '\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069',
    safeRtlText: 'StellarForge: مرحبا שלום (سلام)',
    directionalMarks: 'a\u200eb\u200fc\u061cd',
  },
} as const;
