const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// A small deterministic hook/clock adapter for testing native startup without
// waiting eight real seconds or needing an Android device.
function startupHarness(adapters = {}) {
  let now = 1700000000000;
  let nextTimer = 1;
  const timers = new Map();
  const hooks = [];
  const effects = [];
  const modules = new Map();
  let cursor = 0;
  let dirty = false;
  let component;
  let result;
  const clock = {
    setTimeout(fn, delay) {
      const id = nextTimer++;
      timers.set(id, { fn, at: now + delay });
      return id;
    },
    setInterval(fn, delay) {
      const id = nextTimer++;
      timers.set(id, { fn, at: now + delay, interval: delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          if (timer.interval) timer.at = now + timer.interval;
          else timers.delete(id);
          timer.fn();
        }
      }
    },
  };
  function changed(previous, next) {
    return !previous || !next || previous.length !== next.length || next.some((value, i) => !Object.is(previous[i], value));
  }
  const React = {
    createElement: (type, props, ...children) => ({
      type, props: { ...props, children: children.length === 1 ? children[0] : children },
    }),
    createContext: (value) => ({ value, Provider: 'ContextProvider' }),
    useContext: (context) => context.value,
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[index].value, (value) => {
        const next = typeof value === 'function' ? value(hooks[index].value) : value;
        if (!Object.is(next, hooks[index].value)) { hooks[index].value = next; dirty = true; }
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { current: initial };
      return hooks[index];
    },
    useEffect(fn, dependencies) {
      const index = cursor++;
      if (changed(hooks[index]?.dependencies, dependencies)) {
        effects.push(() => {
          hooks[index]?.cleanup?.();
          hooks[index] = { dependencies, cleanup: fn() };
        });
      }
    },
    useMemo(fn, dependencies) {
      const index = cursor++;
      if (changed(hooks[index]?.dependencies, dependencies)) hooks[index] = { dependencies, value: fn() };
      return hooks[index].value;
    },
    useCallback(fn, dependencies) { return React.useMemo(() => fn, dependencies); },
  };
  class Clock extends Date { static now() { return now; } }
  function load(relative) {
    const file = path.resolve(__dirname, '../../', relative);
    if (modules.has(file)) return modules.get(file);
    const exports = {};
    modules.set(file, exports);
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(source, {
      exports, Date: Clock, console,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      setInterval: clock.setInterval,
      clearInterval: clock.clearTimeout,
      require(name) {
        if (Object.hasOwn(adapters, name)) return adapters[name];
        if (name === 'react') return React;
        if (name.startsWith('@/')) {
          const base = path.resolve(__dirname, '../../', name.slice(2));
          const filePath = [base + '.ts', base + '.tsx'].find(fs.existsSync);
          if (filePath) return load(path.relative(path.resolve(__dirname, '../../'), filePath));
        }
        throw new Error(`Missing test adapter for ${name}`);
      },
    }, { filename: file });
    return exports;
  }
  function render() {
    cursor = 0;
    dirty = false;
    result = component();
    while (effects.length) effects.shift()();
    return result;
  }
  return {
    clock, load,
    mount(fn) { component = fn; return render(); },
    render,
    get result() { return result; },
    async settle() {
      for (let i = 0; i < 12; i++) {
        await Promise.resolve();
        if (dirty) render();
      }
      return result;
    },
    unmount() { for (const hook of hooks) hook?.cleanup?.(); },
  };
}

module.exports = { startupHarness };
