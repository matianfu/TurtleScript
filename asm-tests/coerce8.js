// Test verification of call-site coercions.

function coerce(stdlib, foreign, heap) {
    "use asm";

    function f() {
        return 42.0
    }

    // THIS IS A VALID COERCION
    function g() {
        return +f();
    }

    return g;
}
