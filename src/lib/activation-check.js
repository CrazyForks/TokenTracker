const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { readJson } = require("./fs");

/**
 * 跨 AI CLI 自动激活检测
 * 在 tokentracker 各种命令执行时顺带检测并完成配置
 */

const AI_CLIS = [
  {
    name: "codex",
    displayName: "Codex",
    checkInstalled: checkCodexInstalled,
    checkConfigured: checkCodexConfigured,
    configure: configureCodex,
  },
  {
    name: "claude-code",
    displayName: "Claude Code", 
    checkInstalled: checkClaudeCodeInstalled,
    checkConfigured: checkClaudeCodeConfigured,
    configure: configureClaudeCode,
  },
  {
    name: "opencode",
    displayName: "OpenCode",
    checkInstalled: checkOpencodeInstalled,
    checkConfigured: checkOpencodeConfigured,
    configure: configureOpencode,
  },
  {
    name: "every-code",
    displayName: "Every Code",
    checkInstalled: checkEveryCodeInstalled,
    checkConfigured: checkEveryCodeConfigured,
    configure: configureEveryCode,
  },
  {
    name: "openclaw",
    displayName: "OpenClaw",
    checkInstalled: checkOpenclawInstalled,
    checkConfigured: checkOpenclawConfigured,
    configure: configureOpenclaw,
  },
];

/**
 * 检测所有 AI CLI 并自动配置未完成的
 * @param {Object} options
 * @param {string} options.home - home目录
 * @param {boolean} options.silent - 是否静默模式
 * @param {boolean} options.autoConfigure - 是否自动配置（否则仅提示）
 */
async function checkAndActivate({ home = os.homedir(), silent = true, autoConfigure = true } = {}) {
  const results = [];
  
  for (const cli of AI_CLIS) {
    try {
      const isInstalled = await cli.checkInstalled({ home });
      if (!isInstalled) continue;
      
      const isConfigured = await cli.checkConfigured({ home });
      if (isConfigured) continue;
      
      // 发现已安装但未配置的 CLI
      if (autoConfigure) {
        const success = await cli.configure({ home, silent });
        results.push({
          name: cli.name,
          displayName: cli.displayName,
          action: success ? "configured" : "failed",
        });
        
        if (!silent && success) {
          console.log(`✅ 已自动配置 ${cli.displayName} 集成`);
        }
      } else {
        results.push({
          name: cli.name,
          displayName: cli.displayName,
          action: "pending",
        });
        
        if (!silent) {
          console.log(`⏳ 检测到 ${cli.displayName} 未配置，运行 'tokentracker init' 以配置`);
        }
      }
    } catch (err) {
      // 静默忽略错误，不影响主流程
      if (!silent) {
        console.error(`检查 ${cli.displayName} 失败:`, err.message);
      }
    }
  }
  
  return results;
}

// ===== Codex 检测与配置 =====

async function checkCodexInstalled({ home }) {
  const configPath = path.join(home, ".codex", "config.toml");
  try {
    await fs.access(configPath);
    return true;
  } catch {
    return false;
  }
}

async function checkCodexConfigured({ home }) {
  const configPath = path.join(home, ".codex", "config.toml");
  try {
    const content = await fs.readFile(configPath, "utf8");
    // 检查是否已配置 notify
    return content.includes("tokentracker") || content.includes("notify");
  } catch {
    return false;
  }
}

async function configureCodex({ home, silent }) {
  try {
    // 使用现有的 codex-config 模块
    const { upsertCodexNotify } = require("./codex-config");
    const notifyCmd = path.join(home, ".tokentracker", "bin", "notify.cjs");
    const codexConfigPath = path.join(home, ".codex", "config.toml");
    const notifyOriginalPath = path.join(home, ".tokentracker", "backups", "codex-notify-original.json");
    
    await upsertCodexNotify({
      codexConfigPath,
      notifyCmd,
      notifyOriginalPath,
    });
    return true;
  } catch (err) {
    if (!silent) console.error("配置 Codex 失败:", err.message);
    return false;
  }
}

// ===== Claude Code 检测与配置 =====

async function checkClaudeCodeInstalled({ home }) {
  const settingsPath = path.join(home, ".claude", "settings.json");
  try {
    await fs.access(settingsPath);
    return true;
  } catch {
    return false;
  }
}

async function checkClaudeCodeConfigured({ home }) {
  const settingsPath = path.join(home, ".claude", "settings.json");
  try {
    const settings = await readJson(settingsPath);
    // 检查是否已有 tokentracker 相关的 hook
    const hooks = settings?.hooks?.SessionStart || [];
    return hooks.some(h =>
      h.hooks?.some(hook => hook.command?.includes("tokentracker"))
    );
  } catch {
    return false;
  }
}

async function configureClaudeCode({ home, silent }) {
  try {
    const settingsPath = path.join(home, ".claude", "settings.json");
    const settings = (await readJson(settingsPath)) || {};
    
    // 添加 SessionStart hook
    if (!settings.hooks) settings.hooks = {};
    if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];
    
    // 检查是否已存在
    const exists = settings.hooks.SessionStart.some(h => 
      h.matcher === "startup" &&
      h.hooks?.some(hook => hook.command?.includes("tokentracker activate-if-needed"))
    );
    
    if (!exists) {
      settings.hooks.SessionStart.push({
        matcher: "startup",
        hooks: [{
          type: "command",
          command: "tokentracker activate-if-needed --silent 2>/dev/null || true"
        }]
      });
      
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
    }
    return true;
  } catch (err) {
    if (!silent) console.error("配置 Claude Code 失败:", err.message);
    return false;
  }
}

// ===== OpenCode 检测与配置 =====

async function checkOpencodeInstalled({ home }) {
  const configPath = path.join(home, ".config", "opencode", "opencode.json");
  try {
    await fs.access(configPath);
    return true;
  } catch {
    return false;
  }
}

async function checkOpencodeConfigured({ home }) {
  const pluginDir = path.join(home, ".config", "opencode", "plugins");
  try {
    const files = await fs.readdir(pluginDir);
    return files.some(f => f.includes("tokentracker"));
  } catch {
    return false;
  }
}

async function configureOpencode({ home, silent }) {
  try {
    const pluginDir = path.join(home, ".config", "opencode", "plugins");
    await fs.mkdir(pluginDir, { recursive: true });
    
    const pluginPath = path.join(pluginDir, "tokentracker-activation.js");
    const pluginCode = `export const TokentrackerActivation = async ({ $ }) => {
  return {
    "session.created": async () => {
      await $'tokentracker activate-if-needed --silent'.quiet().nothrow();
    }
  };
};`;
    
    await fs.writeFile(pluginPath, pluginCode, "utf8");
    return true;
  } catch (err) {
    if (!silent) console.error("配置 OpenCode 失败:", err.message);
    return false;
  }
}

// ===== Every Code 检测与配置 =====

async function checkEveryCodeInstalled({ home }) {
  const configPath = path.join(home, ".code", "config.toml");
  try {
    await fs.access(configPath);
    return true;
  } catch {
    return false;
  }
}

async function checkEveryCodeConfigured({ home }) {
  const configPath = path.join(home, ".code", "config.toml");
  try {
    const content = await fs.readFile(configPath, "utf8");
    return content.includes("tokentracker");
  } catch {
    return false;
  }
}

async function configureEveryCode({ home, silent }) {
  try {
    // Every Code 配置类似 Codex
    const configPath = path.join(home, ".code", "config.toml");
    let content = "";
    try {
      content = await fs.readFile(configPath, "utf8");
    } catch {
      content = "";
    }
    
    const notifyCmd = path.join(home, ".tokentracker", "bin", "notify.cjs");
    const notifyLine = `notify = ["/usr/bin/env", "node", "${notifyCmd}"]`;

    if (!content.includes("tokentracker")) {
      content = content.trim() + "\n\n# tokentracker integration\n" + notifyLine + "\n";
      await fs.writeFile(configPath, content, "utf8");
    }
    return true;
  } catch (err) {
    if (!silent) console.error("配置 Every Code 失败:", err.message);
    return false;
  }
}

module.exports = {
  checkAndActivate,
  AI_CLIS,
};

// ===== OpenClaw 检测与配置 =====

async function checkOpenclawInstalled({ home }) {
  const configPath = path.join(home, ".openclaw", "openclaw.json");
  try {
    await fs.access(configPath);
    return true;
  } catch {
    return false;
  }
}

async function checkOpenclawConfigured({ home }) {
  const { probeOpenclawSessionPluginState } = require("./openclaw-session-plugin");
  const { resolveTrackerPaths } = require("./tracker-paths");
  try {
    const { trackerDir } = await resolveTrackerPaths({ home });
    const state = await probeOpenclawSessionPluginState({ home, trackerDir, env: process.env });
    return state?.configured === true;
  } catch {
    return false;
  }
}

async function configureOpenclaw({ home, silent }) {
  try {
    const { installOpenclawSessionPlugin } = require("./openclaw-session-plugin");
    const { resolveTrackerPaths } = require("./tracker-paths");
    const { trackerDir } = await resolveTrackerPaths({ home });
    
    const result = await installOpenclawSessionPlugin({
      home,
      trackerDir,
      packageName: "tokentracker-cli",
      env: process.env,
    });
    
    return result?.configured === true;
  } catch (err) {
    if (!silent) console.error("配置 OpenClaw 失败:", err.message);
    return false;
  }
}