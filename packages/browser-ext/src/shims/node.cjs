const unavailable = (name) => () => {
  throw new Error(`odin: ${name} is not available in the browser`);
};
const names = [
  "execFile", "spawn", "existsSync", "mkdtempSync", "readFile", "rmSync",
  "symlinkSync", "tmpdir",
];
const shim = {};
for (const name of names) shim[name] = unavailable(name);
shim.promisify = (fn) => async (...args) => fn(...args);
shim.tmpdir = () => "/tmp";
shim.platform = () => "browser";
shim.cpus = () => [];
shim.EOL = "\n";
shim.performance = globalThis.performance;
shim.isAbsolute = (path) => path.startsWith("/");
shim.join = (...parts) => parts.filter(Boolean).join("/").replace(/\/+/g, "/");
shim.resolve = (...parts) => shim.join(...parts);
shim.sep = "/";
shim.EOL = "\n";
shim.promises = shim;
shim.default = shim;
module.exports = shim;
