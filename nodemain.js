// Main module for node compatibility.  Makes our AMD modules look like
// a standard node module.

var requirejs = require('requirejs');
requirejs.config({
    nodeRequire: require,
    baseUrl: __dirname,
    deps:['./extensions']
});

// Set up some global context.
requirejs.define('timeouts', {
    // Use node's own `setTimeout`/`clearTimeout` functions.
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
});

// Define our language/library extensions (globally, alas).
requirejs('./extensions');

module.exports = Object.create(null);
// Things to export.
['parse', 'jcompile',
 // Bytecode compiler-interpreter.
 'bytecode-table', 'bcompile', 'binterp', 'stdlib',
 // `asm.js` project.
 'asm-llvm',
 // FRS-style event system.
 'events', 'eventtests',
 // Top-level declarations suitable for compiling TurtleScript modules.
 'top-level',
 // A collection of interesting TurtleScript test cases.
 'tests'
].forEach(function(m) {
     module.exports[m.replace('-','_')] = requirejs('./'+m);
 });

// Command-line utilities.
module.exports.write_rust_bytecode = function() {
    // This module has side-effects when imported.
    requirejs('./write-rust-bytecode');
};
module.exports.write_rust_ops = function() {
    // This module has side-effects when imported.
    requirejs('./write-rust-ops');
};
