const WORLD_STATE = { "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4": { nonce: 1, balance: 1000000n, code: null} };

const OPCODE_FUNC = OpFunc();

const DEBUG_ALL = 0xff;
const DEBUG_OFF = 0x00;
const DEBUG_STACK = 0x01;
const DEBUG_MEMORY = 0x02;

const EVM = {
    status: "idle",
    debug: DEBUG_OFF,
    state: WORLD_STATE,
    step: function(debug = DEBUG_OFF) {
        this.debug = debug;
        var opcode = this.bytecode[this.pc];
        var opfunc = OPCODE_FUNC[opcode] ?? null;
        if (opfunc === null) {
            return "opcode {" + opcode.toString(16) + "} has not been implemented yet"
        }
        if (this.debug & DEBUG_STACK === DEBUG_STACK) console.log("stack info: \n" + this.stackInfo());
        if (this.debug & DEBUG_MEMORY === DEBUG_MEMORY) console.log("memory info: \n" + ToHexString(this.memory.data));
        return opfunc(this);
    },
    forward: function(debug = 0, breakpoint = -1) {
        this.debug = debug;

        if (this.status !== "running" && this.status !== "paused") return { status: -1, message: "no program running" };

        if (this.status === "paused") this.status = "running";

        var result = { status: 0, message: "" };

        while (result.status === 0) {
            if (this.debug > 0 && this.pc === breakpoint) {
                this.status = "paused";
                console.log("break point: " + breakpoint, EVM);
                if (this.debug & DEBUG_STACK === DEBUG_STACK) console.log("stack info: \n" + this.stackInfo());
                if (this.debug & DEBUG_MEMORY === DEBUG_MEMORY) console.log("memory info: \n" + ToHexString(this.memory.data));
                return { status: -1, message: "paused" };
            }
            var opcode = this.bytecode[this.pc];
            var opfunc = OPCODE_FUNC[opcode] ?? null;
            if (opfunc === null) {
                result.status = -1;
                result.message = "opcode {" + opcode.toString(16) + "} has not been implemented yet"
                break;
            }
            result = opfunc(this);
        }

        if (result.status === 1) {
            if (this.tx.to === null) {
                this.state[this.address] = {
                    nonce: 1,
                    balance: 0,
                    code: result.bytes,
                    storage: {}
                }
                this.state[this.tx.origin].nonce += 1
            }
        }

        this.status = "idle";

        return result;
    },
    execute: function(transaction, debug = 0, breakpoint = -1) {
        this.status = "running";

        this.tx = { origin: transaction.from, to: transaction.to };
        this.msg = { sender: transaction.from, value: transaction.value };
        this.pc = 0;
        this.stack = Stack(this);
        this.memory = Memory(this);
        this.address = transaction.to;
        this.calldata = FromHexString(transaction.data);
        this.bytecode = transaction.to === null ? FromHexString(transaction.data) : this.state[transaction.to].code;

        if (this.address === null) {
            var nonce = "0x" + this.state[this.tx.origin].nonce.toString(16);
            var hashSource = RLP.encode([this.tx.origin, nonce]);
            var hashBytes = keccak256([ ...hashSource ]);
            this.address = ToHexString(hashBytes.slice(12));
        }

        return this.forward(debug, breakpoint);

    },
    stackInfo: function() {
        return Array.from(this.stack.data).reverse().reduce((str, value) => (str += ToHexString(value) + "\n"), "");
    }
};

function Stack(evm) {
    return {
        data: new Array(),
        push: function(value) { this.data.push(value) },
        pop: function() { return this.data.pop() },
        dup: function(position) { this.data.push(this.data[this.data.length - position]) }
    }
}

function Memory(evm) {
    return {
        data: new Uint8Array(),
        touch: function(offset) {
            var size = Math.ceil((offset + 32) / 32) * 32;
            if (this.data.length < size) {
                if (evm.debug & DEBUG_MEMORY === DEBUG_MEMORY) console.log("memory expand to: ", size)
                var _data  = new Uint8Array(size);
                for (let i = 0; i < this.data.length; i++) {
                    _data[i] = this.data[i];
                }
                this.data = _data;
            }
        },
        read: function(offset) {
             if (evm.debug & DEBUG_MEMORY === DEBUG_MEMORY) console.log("memory read at: ", offset, offset.toString(16));
            this.touch(offset);
            return this.data.slice(offset, offset + 32);
        },
        write: function(offset, value, byte = false) {
             if (evm.debug & DEBUG_MEMORY === DEBUG_MEMORY) console.log("memory write to: ", offset, offset.toString(16), value);
            this.touch(offset);
            if (byte) {
                this.data[offset] = value;
            } else {
                for (let i = 0; i < 32; i++) {
                    this.data[offset + i] = value[i];
                }
            }
        }
    }
}

function OpFunc() {
    const dup = (evm, position) => {
        evm.stack.dup(position)
        evm.pc += 1;
        return { status: 0, message: "" };
    };

    const push = (evm, size) => {
        var result = new Uint8Array(32);
        for (let i = 0; i < size; i++) {
            result[32 - size + i] = evm.bytecode[evm.pc + 1 + i];
        }
        evm.stack.push(result);
        evm.pc += size + 1;
        return { status: 0, message: "" };
    };

    const swap = (evm, position) => {
        var size = evm.stack.data.length;
        var tmp = evm.stack.data[size - 1];
        evm.stack.data[size - 1] = evm.stack.data[size - position]
        evm.stack.data[size - position] = tmp;
        evm.pc += 1;
        return { status: 0, message: "" };
    };

    return {
        // ADD
        0x01: evm => {
            var a = BigInt.asIntN(256, BigInt(ToHexString(evm.stack.pop())));
            var b = BigInt.asIntN(256, BigInt(ToHexString(evm.stack.pop())));
            var result = FromHexString(BigInt.asUintN(256, (a + b)).toString(16).padStart(64, '0'));
            evm.stack.push(result);
            evm.pc += 1;
            return { status: 0, message: "" };
        },
        // SUB
        0x03: evm => {
            var a = BigInt.asIntN(256, BigInt(ToHexString(evm.stack.pop())));
            var b = BigInt.asIntN(256, BigInt(ToHexString(evm.stack.pop())));
            var result = FromHexString(BigInt.asUintN(256, (a - b)).toString(16).padStart(64, '0'));
            evm.stack.push(result);
            evm.pc += 1;
            return { status: 0, message: "" };
        },
        // LT
        0x10: evm => {
            var result = new Uint8Array(32);
            var a = BigInt.asUintN(256, BigInt(ToHexString(evm.stack.pop())));
            var b = BigInt.asUintN(256, BigInt(ToHexString(evm.stack.pop())));
            if (a < b) {
                result[31] = 1;
            }
            evm.stack.push(result);
            evm.pc += 1;
            return { status: 0, message: "" };
        },
        // SLT
        0x12: evm => {
            var result = new Uint8Array(32);
            var a = BigInt.asIntN(256, BigInt(ToHexString(evm.stack.pop())));
            var b = BigInt.asIntN(256, BigInt(ToHexString(evm.stack.pop())));
            if (a < b) {
                result[31] = 1;
            }
            evm.stack.push(result);
            evm.pc += 1;
            return { status: 0, message: "" };
        },
        // EQ
        0x14: evm => {
            var result = new Uint8Array(32);
            var a = BigInt(ToHexString(evm.stack.pop()));
            var b = BigInt(ToHexString(evm.stack.pop()));
            if (a === b) {
                result[31] = 1;
            }
            evm.stack.push(result);
            evm.pc += 1;
            return { status: 0, message: "" };
        },
        // ISZERO
        0x15: evm => {
            var result = new Uint8Array(32);
            var value = BigInt(ToHexString(evm.stack.pop()));
            if (value === 0n) {
                result[31] = 1;
            }
            evm.stack.push(result);
            evm.pc += 1;
            return { status: 0, message: "" };
        },
        // SHR
        0x1c: evm => {
            var shift = evm.stack.pop()[31];
            var value = BigInt.asUintN(256, BigInt(ToHexString(evm.stack.pop()))) >> BigInt(shift);
            var result = FromHexString(value.toString(16).padStart(64, '0'));
            evm.stack.push(result);
            evm.pc += 1;
            return { status: 0, message: "" };
        },
        // SHA3 
        0x20: evm => {
            var offset = Number(BigInt(ToHexString(evm.stack.pop())));
            var size = Number(BigInt(ToHexString(evm.stack.pop())));
            var bytes = new Uint8Array(size);
            if (offset + size <= evm.memory.data.length) {
                bytes.set(evm.memory.data.slice(offset, offset + size), 0);
            } else {
                bytes.set(evm.memory.data.slice(offset), 0);
            }
            var result = keccak256([ ...bytes ]);
            evm.stack.push(result);
            evm.pc += 1;
            return { status: 0, message: "" };
        },
        // CALLVALUE
        0x34: evm => {
            var value = FromHexString(evm.msg.value.toString(16).padStart(64, '0'));
            evm.stack.push(value)
            evm.pc += 1;
            return { status: 0, message: "" };
        },
        // CALLDATALOAD
        0x35: evm => {
            var result = new Uint8Array(32);
            var offset = Number(BigInt(ToHexString(evm.stack.pop())));
            for (let i = 0; i < 32; i++) {
                if (offset + i < evm.calldata.length) {
                    result[i] = evm.calldata[offset + i];
                } else {
                    break;
                }
            }
            evm.stack.push(result);
            evm.pc += 1;
            return { status: 0, message: "" };
        },
        // CALLDATASIZE
        0x36: evm => {
            var value = FromHexString(evm.calldata.length.toString(16).padStart(64, '0'));
            evm.stack.push(value);
            evm.pc += 1;
            return { status: 0, message: "" };
        },
        // CODECOPY
        0x39: evm => {
            var destOffset = Number(BigInt(ToHexString(evm.stack.pop())));
            var offset = Number(BigInt(ToHexString(evm.stack.pop())));
            var size = Number(BigInt(ToHexString(evm.stack.pop())));
            var value = 0;
            for (let i = 0; i < size; i++) {
                if (offset + i < evm.bytecode.length) {
                    value = evm.bytecode[offset + i];
                } else {
                    value = 0;
                }
                evm.memory.write(destOffset + i, value, true);
            }
            evm.pc += 1;
            return { status: 0, message: "" };
        },
        // POP
        0x50: evm => {
            evm.stack.pop();
            evm.pc += 1;
            return { status: 0, message: "" };
        },
        // MLOAD
        0x51: evm => {
            var offset = Number(BigInt(ToHexString(evm.stack.pop())));
            var result = new Uint8Array(32);
            if (offset + 32 <= evm.memory.data.length) {
                result.set(evm.memory.data.slice(offset, offset + 32), 0);
            } else {
                result.set(evm.memory.data.slice(offset), 0);
            }
            evm.stack.push(result);
            evm.pc += 1;
            return { status: 0, message: "" };
        },
        // MSTORE
        0x52: evm => {
            var offset = Number(BigInt(ToHexString(evm.stack.pop())));
            var value = evm.stack.pop();
            evm.memory.write(offset, value);
            evm.pc += 1;
            return { status: 0, message: "" };
        },
        // JUMP
        0x56: evm => {
            var counter = Number(BigInt(ToHexString(evm.stack.pop())));
            evm.pc = counter;
            return { status: 0, message: "" };
        },
        // JUMPI
        0x57: evm => {
            var counter = Number(BigInt(ToHexString(evm.stack.pop())));
            var value = BigInt(ToHexString(evm.stack.pop()));
            if (value !== 0n) {
                evm.pc = counter;
            } else {
                evm.pc += 1;
            }
            return { status: 0, message: "" };
        },
        // JUMPDEST
        0x5b: evm => {
            evm.pc += 1;
            return { status: 0, message: "" };
        },
        // PUSH0
        0x5f: evm => push(evm, 0),
        // PUSH1
        0x60: evm => push(evm, 1),
        // PUSH2
        0x61: evm => push(evm, 2),
        // PUSH3
        0x62: evm => push(evm, 3),
        // PUSH4
        0x63: evm => push(evm, 4),
        // DUP1
        0x80: evm => dup(evm, 1),
        // DUP2
        0x81: evm => dup(evm, 2),
        // DUP3
        0x82: evm => dup(evm, 3),
        // DUP4
        0x83: evm => dup(evm, 4),
        // DUP5
        0x84: evm => dup(evm, 5),
        // DUP6
        0x85: evm => dup(evm, 6),
        // SWAP1
        0x90: evm => swap(evm, 2),
        // SWAP2
        0x91: evm => swap(evm, 3),
        // SWAP3
        0x92: evm => swap(evm, 4),
        // SWAP4
        0x93: evm => swap(evm, 5),
        // SWAP5
        0x94: evm => swap(evm, 6),
        // SWAP6
        0x95: evm => swap(evm, 7),
        // SWAP7
        0x96: evm => swap(evm, 8),
        // SWAP8
        0x97: evm => swap(evm, 9),
        // RETURN
        0xf3: evm => {
            var offset = Number(BigInt(ToHexString(evm.stack.pop())));
            var size = Number(BigInt(ToHexString(evm.stack.pop())));
            var data = evm.memory.data.slice(offset, offset + size);
            return { status: 1, message: "returned", bytes: data };
        },
        // REVERT
        0xfd: evm => {
            var offset = Number(BigInt(ToHexString(evm.stack.pop())));
            var size = Number(BigInt(ToHexString(evm.stack.pop())));
            var data = evm.memory.data.slice(offset, offset + size);
            return { status: 2, message: "reverted", bytes: data };
        },
    }
}

//辅助方法
const FromHexString = (hexString) => Uint8Array.from((hexString.slice(0,2) === "0x" ? hexString.slice(2) : hexString).match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));

const ToHexString = (bytes) => bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), "0x");

const HexToBinString = (hexString) => (hexString.slice(0,2) === "0x" ? hexString.slice(2) : hexString).match(/.{1,2}/g).map((byte) => parseInt(byte, 16)).reduce((str, byte) => str + byte.toString(2).padStart(8, '0'), "");
