// binterp.js
// Bytecode interpreter, written in Simplified JavaScript.
// XXX: string coercions aren't quite right yet

// C. Scott Ananian
// 2011-05-11

var make_binterp = function(bytecode_table) {
    var mkstate = function(parent, frame, module, func_id) {
        return {
            parent: parent,
            frame: frame,
            stack: [],
            pc: 0,
            // from bytecode file
            module: module,
            func_id: func_id,
            bytecode: module.functions[func_id].bytecode,
            strings: module.strings
        };
    };

    var dispatch = {};
    var SLOT_PREFIX = "!bi!"; // prevent leaking slots from metacontext

    var MyObject = {};
    MyObject.type = "object";
    var MyArray = Object.create(MyObject);
    MyArray.type = "array";
    MyArray[SLOT_PREFIX+"length"] = 0;
    var MyFunction = Object.create(MyObject);
    MyFunction.type = "function";
    var MyString = Object.create(MyObject);
    MyString.type = "string";

    var interpret = function(state) {
        var op = bytecode_table.for_num(state.bytecode[state.pc]);
        /*
        document.write("Executing: " +
                       state.pc + ": " +
                       op.name +
                       op.printargs(state.module, state.bytecode, state.pc)+
                       "  \n");
        */
        var args = [];
        var i = 0;
        while (i < op.args) {
            args.push(state.bytecode[state.pc + i + 1]);
            i += 1;
        }
        state.pc += 1 + op.args;
        var ns = dispatch[op.name].apply(state, args);
        /*
        document.write(JSON.stringify(state.stack,
                                      ['type', SLOT_PREFIX+"length"])+"\n");
        */
        return ns ? ns : state;
    };

    var push_op = function(x) {
        return function() {
            this.stack.push(x);
        };
    };
    dispatch.push_frame = function() {
        this.stack.push(this.frame);
    };
    dispatch.push_null = push_op(null);
    dispatch.push_true = push_op(true);
    dispatch.push_false =push_op(false);
    dispatch.push_number = function(num) {
        this.stack.push(num);
    };
    dispatch.push_string = function(idx) {
        this.stack.push(this.strings[idx]);
    };
    dispatch.new_object = function() {
        this.stack.push(Object.create(MyObject));
    };
    dispatch.new_array = function() {
        this.stack.push(Object.create(MyArray));
    };
    dispatch.new_function = function(idx) {
        var f = Object.create(MyFunction);
        // hidden fields of function object
        f.parent_frame = this.frame;
        f.module = this.module;
        f.func_id = idx;
        this.stack.push(f);
    };
    var get_slot = function(obj, name) {
        if (typeof(obj)==="string") {
            // special case fields of String
            if (name === "__proto__") {
                return MyString;
            }
            if (name === "length" || isFinite(1 * name)) {
                return obj[name];
            }
            return MyString[SLOT_PREFIX+name];
        }
        return obj[SLOT_PREFIX+name];
    };
    dispatch.get_slot_direct = function(slot_name_idx) {
        var obj = this.stack.pop();
        var name = this.strings[slot_name_idx];
        this.stack.push(get_slot(obj, name));
    };
    dispatch.get_slot_direct_check = function(slot_name_idx) {
        var obj = this.stack.pop();
        var name = this.strings[slot_name_idx];
        var result = get_slot(obj, name);
        if (!result) {
            // warn about unimplemented (probably library) functions.
            console.log("Failing lookup of method",
                        this.strings[slot_name_idx]);
        }
        this.stack.push(result);
    }
    dispatch.get_slot_indirect = function() {
        var name = this.stack.pop();
        var obj = this.stack.pop();
        this.stack.push(get_slot(obj, name));
    };
    dispatch.set_slot_direct = function(slot_name_idx) {
        var nval = this.stack.pop();
        var name = this.strings[slot_name_idx]; // not a number
        var obj = this.stack.pop();
        obj[SLOT_PREFIX+name] = nval;
    };
    dispatch.set_slot_indirect = function() {
        var nval = this.stack.pop();
        var name = this.stack.pop();
        var obj = this.stack.pop();
        // handle array sets specially: they update the length field.
        if (obj.type === "array" && isFinite(1 * name)) {
            name = 1 * name; // convert to int
            if (name >= obj[SLOT_PREFIX+"length"]) {
                obj[SLOT_PREFIX+"length"] = name + 1;
            }
        }
        obj[SLOT_PREFIX+name] = nval;
    };
    dispatch.invoke = function(nargs) {
        // collect arguments.
        var i = nargs;
        var my_arguments = Object.create(MyArray);
        while (i > 0) {
            my_arguments[SLOT_PREFIX+(i-1)] = this.stack.pop();
            i -= 1;
        }
        my_arguments[SLOT_PREFIX+"length"] = nargs;
        // collect 'this'
        var my_this = this.stack.pop();
        // get function object
        var func = this.stack.pop();
        // assert func is a function
        if (func === null || typeof(func) !== "object" ||
            func.type !== "function") {
            // XXX: throw wrapped TypeError
            Object.error("Not a function at "+this.stack.pc, {});
        }
        // "native code"
        if (func.type === "function" && func.native_code) {
            // build proper native arguments array
            var native_args = [ my_this ];
            i = 0;
            while (i < nargs) {
                native_args.push(my_arguments[SLOT_PREFIX+i]);
                i += 1;
            }
            this.stack.push(func.native_code.apply(this, native_args));
            return;
        }
        // create new frame
        var nframe = Object.create(func.parent_frame);
        nframe[SLOT_PREFIX+"arguments"] = my_arguments;
        nframe[SLOT_PREFIX+"this"] = my_this;
        // construct new child state.
        var ns = mkstate(this, nframe, func.module, func.func_id);
        //document.write("----- ENTERING FUNCTION #"+func.func_id+" -----\n");
        // ok, continue executing in child state!
        return ns;
    };
    dispatch["return"] = function() {
        var retval = this.stack.pop();
        // go up to the parent state.
        var ns = this.parent;
        ns.stack.push(retval);
        // continue in parent state
        //document.write("----- RETURNING TO FUNCTION #"+ns.func_id+" -----\n");
        return ns;
    };

    // branches
    var branch = function(f) {
        return function(new_pc) {
            if (typeof(new_pc) !== "number") {
                new_pc = new_pc.label;
            }
            this.pc = f.call(this, new_pc);
        };
    };
    dispatch.jmp = branch(function(new_pc) {
        return new_pc;
    });
    dispatch.jmp_unless = branch(function(new_pc) {
        var condition = this.stack.pop();
        return condition ? this.pc : new_pc;
    });

    // stack manipulation
    dispatch.pop = function() {
        this.stack.pop();
    };
    dispatch.dup = function() {
        var top = this.stack[this.stack.length-1];
        this.stack.push(top);
    };
    dispatch["2dup"] = function() {
        var top = this.stack[this.stack.length-1];
        var nxt = this.stack[this.stack.length-2];
        this.stack.push(nxt);
        this.stack.push(top);
    };
    dispatch.over = function() {
        var top = this.stack.pop();
        var nxt = this.stack.pop();
        this.stack.push(top);
        this.stack.push(nxt);
        this.stack.push(top);
    };
    dispatch.over2 = function() {
        var top = this.stack.pop();
        var nx1 = this.stack.pop();
        var nx2 = this.stack.pop();
        this.stack.push(top);
        this.stack.push(nx2);
        this.stack.push(nx1);
        this.stack.push(top);
    };
    dispatch.swap = function() {
        var top = this.stack.pop();
        var nxt = this.stack.pop();
        this.stack.push(top);
        this.stack.push(nxt);
    };

    // unary operators
    var unary = function(f) {
        return function() {
            this.stack.push(f(this.stack.pop()));
        };
    };
    dispatch.un_not = unary(function(arg) { return !arg; });
    dispatch.un_minus = unary(function(arg) { return -arg; });
    dispatch.un_typeof = unary(function(arg) {
        var t = typeof(arg);
        if (t === "object") {
            t = t.type;
            if (t === "array") {
                // weird javascript misfeature
                t = "object";
            }
        }
        return t;
    });
    var binary = function(f) {
        return function() {
            var right = this.stack.pop();
            var left = this.stack.pop();
            this.stack.push(f(left, right));
        };
    };
    dispatch.bi_or = binary(function(l, r) { return l || r; });
    dispatch.bi_and = binary(function(l, r) { return l && r; });
    dispatch.bi_eq = binary(function(l, r) { return l === r; });
    dispatch.bi_gt = binary(function(l, r) { return l > r; });
    dispatch.bi_gte = binary(function(l, r) { return l >= r; });
    dispatch.bi_add = binary(function(l, r) { return l + r; });
    dispatch.bi_sub = binary(function(l, r) { return l - r; });
    dispatch.bi_mul = binary(function(l, r) { return l * r; });
    dispatch.bi_div = binary(function(l, r) { return l / r; });

    var make_top_level_frame = function() {
        var frame = {};
        var oset = function(obj, name, value) {
            obj[SLOT_PREFIX+name] = value;
        };
        var fset = function(name, value) {
            oset(frame, name, value);
        };
        // set up 'this' and 'arguments'
        fset("this", this);
        var my_arguments = Object.create(MyArray);
        oset(my_arguments, "length", arguments.length);
        var i = 0;
        while ( i < arguments.length ) {
            oset(my_arguments, i, arguments[i]);
            i += 1;
        }
        fset("arguments", my_arguments);

        // Constants
        var my_ObjectCons = Object.create(MyFunction);
        oset(my_ObjectCons, "prototype", MyObject);
        fset("Object", my_ObjectCons);

        var my_ArrayCons = Object.create(MyFunction);
        oset(my_ArrayCons, "prototype", MyArray);
        fset("Array", my_ArrayCons);

        var my_StringCons = Object.create(MyFunction);
        oset(my_StringCons, "prototype", MyString);
        fset("String", my_StringCons);

        // support for console.log
        var my_console = Object.create(MyObject);
        fset("console", my_console);

        // Functions
        var native_func = function(obj, name, f) {
            var my_func = Object.create(MyFunction);
            my_func.parent_frame = frame;
            my_func.native_code = f;
            oset(obj, name, my_func);
        };
        native_func(my_console, "log", function() {
            arguments[0] = "INTERP:";
            console.log.apply(console, arguments);
        });
        native_func(MyObject, "hasOwnProperty", function(_this_, propname) {
            return _this_.hasOwnProperty(SLOT_PREFIX+propname);
        });
        native_func(MyObject, "create", function(_this_, prototype) {
            var result = Object.create(prototype);
            oset(result, "__proto__", prototype);
            return result;
        });
        native_func(frame, "isFinite", function(_this_, number) {
            return isFinite(number);
        });

        return frame;
    };
    var library_init = function() {
        String.prototype.charAt = function(idx) {
            return this[idx];
        };
        String.prototype.indexOf = function(searchValue, from) {
            var i = from || 0;
            var j = 0;
            if (i > this.length) {
                i = this.length;
            }
            while ( i < this.length ) {
                j = 0;
                while (j < searchValue.length && this[i+j] === searchValue[j]) {
                    j += 1;
                }
                if (j === searchValue.length) {
                    break;
                }
                i += 1;
            }
            return (j === searchValue.length) ? i : -1;
        };
        Array.prototype.push = function() {
            var i = 0, j = (1*this.length) || 0;
            while (i < arguments.length) {
                this[j] = arguments[i];
                i += 1;
                j += 1;
            }
            return j;
        };
    };

    var binterp = function(module, func_id, frame) {
        var TOP = { stack: [] };
        var FRAME = frame ? frame : make_top_level_frame.call(null);

        var state = mkstate(TOP, FRAME, module, func_id);
        while (state !== TOP) {
            state = interpret(state);
        }
        return TOP.stack.pop();
    };
    return {
        binterp: binterp,
        make_top_level_frame: make_top_level_frame,
        library_init: library_init
    };
};
