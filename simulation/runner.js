var vm = require('vm'),
util = require('./util'),
child_proc = require('child_process');

function SandboxException(e, i) {
    this.type = e.n;
    this.msg = e.m;
    this.i = i;
}
SandboxException.prototype.toString = function() {
    return 'SBOX_ERR: P_' + this.i + ' - `' + this.type + '` ' + this.msg;
}

function TimeoutException(pid) {
    this.pid = pid;
}
TimeoutException.prototype.toString = function() {
    return "Subprocess timed out";
}

const INIT = 0, DONE = 1, RUN = 2, KILLED = 3;
function Runner(api, code, errBack, timeLimit) {
    var ctx = vm.createContext(api),
    proc = [], cback = [],
    i, turn = 0;

    function timeoutKill(i) {
        return function() {
            if (proc[i].state != KILLED){
                proc[i].p.kill('SIGKILL');
                if(proc[i].state == INIT) {
                    errBack(new TimeoutException(i));
                } else if(proc[i].state == RUN) {
                    proc[i].callback(false, new TimeoutException)
                }
                proc[i].state = KILLED;
            }
        }
    }

    function messageHandler(i) {
        return function(m) {
            var type = m.type, data = m.data;
            if(type == 'init_done') {
                clearTimeout(proc[i].timeout);
                proc[i].state = DONE;
            } else if(type == 'result') {
                clearTimeout(proc[i].timeout);
                proc[i].callback(true, data);
                proc[i].state = DONE;
            } else if(type == 'error') {
                if(proc[i].state == INIT) {
                    errBack(i);
                } else if(proc[i].state == RUN) {
                    var e = new SandboxException(data, i);
                    proc[i].callback(false, e);
                }
                proc[i].state = DONE;
            }

            if(proc[i].q.length > 0) {
                runCode.apply(this, proc[i].q.pop());
            }
        }
    }

    for(i = 0; i < code.length; i++) {
        proc[i] = {};
        proc[i].q = [];
        proc[i].p = child_proc.fork('./simulation/sandbox.js');
        proc[i].p.on('message', messageHandler(i));
        proc[i].p.send({ type: 'init_context', data: api });
        proc[i].state = INIT;
        proc[i].timeout = setTimeout(timeoutKill(i), timeLimit);
        proc[i].p.send({ type: 'init_code', data: code[i] });
    }

    function runCode(i, input, cback, f_name, timeLimit) {
        if(proc[i].state != DONE) {
            proc[i].q.push(arguments);
        }
        proc[i].state = RUN;
        proc[i].callback = cback;
        proc[i].p.send({ type: 'load_param', data: input });
        proc[i].timeout = setTimeout(timeoutKill(i), timeLimit);
        proc[i].p.send({ type: 'run_code', data: f_name });
    }
    this.runCode = runCode;
}

module.exports.Runner = Runner;
module.exports.TimeoutException = TimeoutException;
