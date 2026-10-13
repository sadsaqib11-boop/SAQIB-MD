/**
 * SAQIB-MD — internal plugin registry
 * index.js populates it after loading all plugins.
 */
let allPlugins = [];

module.exports = {
  set: (list) => { allPlugins = list; },
  all: () => allPlugins,
  /** Find the plugin that owns a given command */
  find: (command) => allPlugins.find((p) => p.commands.includes(command)),
};
