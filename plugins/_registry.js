/**
 * SAQIB-MD — internal plugin registry
 * index.js populates it after loading all plugins.
 * Uses a Map for O(1) command lookup (speed).
 */
let allPlugins = [];
let index = new Map();

module.exports = {
  set: (list) => {
    allPlugins = list;
    index = new Map();
    for (const p of list) {
      for (const cmd of p.commands) {
        if (!index.has(cmd)) index.set(cmd, p); // first plugin wins
      }
    }
  },
  all: () => allPlugins,
  /** Find the plugin that owns a given command (O(1)) */
  find: (command) => index.get(command),
};
