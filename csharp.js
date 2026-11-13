/* A small C# -> JavaScript translator, so the snowbound village can run C# in the browser.
   It covers the everyday subset: classes (fields, properties, constructors, methods, inheritance),
   static Main or top-level statements, var/int/double/string/bool/List<T>/arrays, if/for/foreach/while/switch,
   string interpolation, try/catch, lambdas, Console, Math, Random and the `World` object of this site.
   It is NOT the .NET runtime: no LINQ, generics-aware typing, Dictionary or integer-division semantics. */
(function () {
  const TYPE = '[\\w<>\\[\\],?.]+';
  const NOT_TYPE = new Set(['return', 'throw', 'else', 'new', 'case', 'break', 'continue', 'goto', 'yield', 'await', 'delete', 'typeof', 'in', 'do', 'using']);
  const DEFAULTS = { int: '0', long: '0', short: '0', byte: '0', double: '0', float: '0', decimal: '0', uint: '0', bool: 'false' };

  function interp(m) {                                   // $"text {expr:F2}" -> ("" + CS_S(expr) + ...)
    const body = m.slice(2, -1), parts = []; let lit = '', i = 0;
    const flush = () => { if (lit) { parts.push('\u0003' + lit + '\u0004'); lit = ''; } };
    while (i < body.length) {
      const c = body[i];
      if (c === '{' && body[i + 1] === '{') { lit += '{'; i += 2; continue; }
      if (c === '}' && body[i + 1] === '}') { lit += '}'; i += 2; continue; }
      if (c === '{') {
        let d = 1, j = i + 1; while (j < body.length && d) { if (body[j] === '{') d++; else if (body[j] === '}') d--; j++; }
        let expr = body.slice(i + 1, j - 1), fmt = null;
        const k = expr.lastIndexOf(':');
        if (k > 0 && /^[FfNnDd]\d*$/.test(expr.slice(k + 1).trim())) { fmt = expr.slice(k + 1).trim(); expr = expr.slice(0, k); }
        flush(); parts.push(fmt ? `CS_F(${expr},"${fmt}")` : `CS_S(${expr})`); i = j; continue;
      }
      lit += c; i++;
    }
    flush();
    return '("" + ' + (parts.join(' + ') || '""') + ')';
  }

  function splitParams(p) {
    const out = []; let d = 0, cur = '';
    for (const ch of p) { if (ch === '<') d++; if (ch === '>') d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; }
    if (cur.trim()) out.push(cur);
    return out.map(s => { const m = s.trim().match(/(?:(?:ref|out|in|params|this)\s+)?(?:[\w<>\[\],?.]+\s+)?(\w+)(\s*=\s*.+)?$/); return m ? m[1] + (m[2] || '') : s.trim(); });
  }

  function compile(src) {
    const lits = [];
    const hold = s => { lits.push(s); return '\u0001' + (lits.length - 1) + '\u0002'; };
    let code = src.replace(/\r/g, '');
    code = code.replace(/\$@?"(?:[^"\\\n]|\\.)*"|@"(?:[^"]|"")*"|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)+'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, m => {
      if (m.startsWith('//')) return '';
      if (m.startsWith('/*')) return m.replace(/[^\n]/g, '');
      if (m[0] === '$') return interp(m);
      if (m[0] === '@') return hold(JSON.stringify(m.slice(2, -1).replace(/""/g, '"')));
      if (m[0] === "'") return hold('"' + m.slice(1, -1).replace(/\\'/g, "'").replace(/(^|[^\\])"/g, '$1\\"') + '"');
      return hold(m);
    });
    // the literal pieces of interpolated strings become ordinary string placeholders
    code = code.replace(/\u0003([^\u0004]*)\u0004/g, (_, s) => hold('"' + s + '"'));

    code = code
      .replace(/^\s*using\s+[^;=(\n]+;\s*$/gm, '').replace(/^\s*namespace\s+[\w.]+\s*;\s*$/gm, '').replace(/^\s*\[[^\]\n]*\]\s*$/gm, '')
      .replace(/\bMath\./g, 'CMath.').replace(/\bstring\.Join\(/g, 'CS_Join(').replace(/\bstring\.IsNullOrEmpty\(/g, 'CS_IsNullOrEmpty(')
      .replace(/\b(?:int|long|double|float|decimal)\.Parse\(/g, 'CS_Num(').replace(/\bConvert\.To(?:Int32|Int64|Double|Decimal)\(/g, 'CS_Num(')
      .replace(/\bConvert\.ToString\(/g, 'CS_S(').replace(/\bstring\.Empty\b/g, '""').replace(/\bint\.MaxValue\b/g, '2147483647')
      .replace(/new\s+List<[^;{()]*?>\s*(?:\(\s*\))?\s*\{([^}]*)\}/g, '[$1]')
      .replace(/new\s+List<[^;{()]*?>\s*\([^()]*\)/g, '[]')
      .replace(/new\s+(?:[\w.]+)?\[\s*\]\s*\{([^}]*)\}/g, '[$1]').replace(/new\s*\[\s*\]\s*\{([^}]*)\}/g, '[$1]')
      .replace(/new\s+[\w.]+\[([^\]]+)\]/g, 'new Array($1).fill(0)')
      .replace(/\(\s*(?:int|long)\s*\)\s*(\([^()]*\)|[\w.]+(?:\([^()]*\))?)/g, 'CS_Int($1)')
      .replace(/\(\s*(?:double|float|decimal|string|object)\s*\)\s*/g, '')
      .replace(/\bforeach\s*\(\s*[\w<>\[\],?.]+\s+(\w+)\s+in\s+/g, 'for (const $1 of ')
      .replace(/\bfor\s*\(\s*(?:int|long|var|double)\s+/g, 'for (let ')
      .replace(/\bcatch\s*\(\s*([\w.]+)(?:\s+(\w+))?\s*\)/g, (_, t, n) => 'catch (' + (n || '__e') + ')');

    const RE_CLASS = /^(\s*)(?:(?:public|private|protected|internal|static|sealed|abstract|partial)\s+)*(class|struct|record|interface)\s+(\w+)(?:<[^>]*>)?(?:\s*:\s*([^{]+?))?\s*(\{)?\s*$/;
    const RE_METH = new RegExp('^(\\s*)((?:(?:public|private|protected|internal|static|override|virtual|abstract|async|sealed|new)\\s+)*)(?:(' + TYPE + ')\\s+)?(\\w+)\\s*\\(([^)]*)\\)(?:\\s*:\\s*base\\(([^)]*)\\))?\\s*(?:=>\\s*(.+?);\\s*|\\{\\s*(.*)\\}\\s*|(\\{)?\\s*)$');
    const RE_PROP = new RegExp('^(\\s*)((?:(?:public|private|protected|internal|static|override|virtual|abstract)\\s+)*)(' + TYPE + ')\\s+(\\w+)\\s*=>\\s*(.+?);\\s*$');
    const RE_FIELD = new RegExp('^(\\s*)((?:(?:public|private|protected|internal|static|readonly|const|volatile|new)\\s+)*)(' + TYPE + ')\\s+(\\w+)\\s*(?:=\\s*(.+?))?\\s*(?:;|\\{\\s*get\\b[^}]*\\}\\s*(?:=\\s*(.+?);)?)\\s*$');
    const RE_DECL = new RegExp('^(\\s*)(?:(?:const|readonly)\\s+)?(' + TYPE + ')\\s+(\\w+)(\\s*(?:=|;|,))');

    const classes = {}, stack = [], out = [];
    let pending = null, iface = 0, mainClass = null, hasClass = false;
    const topClass = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].kind === 'class') return stack[i]; return null; };
    const topMethod = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].method) return stack[i].method; return null; };
    const ctx = () => stack.length ? stack[stack.length - 1].kind : 'top';

    for (const raw of code.split('\n')) {
      let line = raw, m, meta = null;
      if (iface) { // inside an interface: skip
        for (const ch of line) { if (ch === '{') iface++; if (ch === '}') iface--; }
        if (!iface) stack.pop();
        out.push({ text: '' }); continue;
      }
      if (ctx() !== 'method' && (m = line.match(RE_CLASS))) {
        const [, ind, kind, name, bases, br] = m; hasClass = true;
        if (kind === 'interface') { out.push({ text: '' }); stack.push({ kind: 'iface' }); iface = br ? 1 : 0; if (!br) pending = { kind: 'iface' }; if (br) iface = 1; continue; }
        const base = (bases || '').split(',').map(s => s.trim()).filter(s => s && !/^I[A-Z]/.test(s))[0];
        classes[name] = classes[name] || { members: {}, base, name };
        line = `${ind}class ${name}${base ? ' extends ' + base.replace(/<.*/, '') : ''}${br ? ' {' : ''}`;
        const entry = { kind: 'class', cls: classes[name] };
        if (br) { pending = entry; } else pending = entry;
      } else if (ctx() === 'class') {
        const cls = topClass().cls;
        if ((m = line.match(RE_PROP))) {
          const [, ind, mods, , name, expr] = m; const st = /static/.test(mods);
          cls.members[name] = { static: st }; line = `${ind}${st ? 'static ' : ''}get ${name}() { return ${expr}; }`; meta = { cls, method: { params: new Set(), locals: new Set(), static: st }, skip: line.length - (`return ${expr}; }`).length };
        } else if ((m = line.match(RE_METH)) && (m[3] || m[4] === cls.name)) {
          const [, ind, mods, type, name, params, baseArgs, expr, inl, br] = m;
          const st = /static/.test(mods), ctor = !type && name === cls.name;
          const ps = splitParams(params);
          const method = { params: new Set(ps.map(p => p.split('=')[0].trim())), locals: new Set(), static: st };
          let head;
          if (ctor) head = `${ind}constructor(${ps.join(', ')})`;
          else { head = `${ind}${st ? 'static ' : ''}${name}(${ps.join(', ')})`; cls.members[name] = { static: st }; if (name === 'Main' && st && !mainClass) mainClass = cls.name; }
          const sup = ctor && cls.base ? ` super(${baseArgs || ''});` : '';
          if (expr !== undefined) { line = `${head} {${sup} return ${expr}; }`; }
          else if (inl !== undefined) { line = `${head} {${sup} ${inl} }`; }
          else { line = head + (br ? ' {' + sup : ''); pending = { kind: 'method', method, needSup: br ? '' : sup }; }
          meta = { cls, method, skip: head.length };
        } else if ((m = line.match(RE_FIELD))) {
          const [, ind, mods, type, name, init, init2] = m; const st = /static|const/.test(mods);
          cls.members[name] = { static: st };
          const v = init !== undefined ? init : init2 !== undefined ? init2 : (DEFAULTS[type] || 'null');
          const hd = `${ind}${st ? 'static ' : ''}${name} = `; line = hd + v + ';'; meta = { cls, method: { params: new Set(), locals: new Set(), static: st }, skip: hd.length };
        }
      } else {                                           // statements: top level or inside a method / block
        const method = topMethod() || stack.__top || (stack.__top = { params: new Set(), locals: new Set(), static: true, top: true });
        meta = { cls: (topClass() || {}).cls, method };
        const mm = !/;\s*$/.test(line) && line.match(RE_METH);
        if (mm && mm[3] && !NOT_TYPE.has(mm[3]) && mm[3] !== 'else') {
          const ps = splitParams(mm[5]); const loc = { params: new Set(ps.map(p => p.split('=')[0].trim())), locals: new Set(), static: true };
          const head = `${mm[1]}function ${mm[4]}(${ps.join(', ')})`; method.locals.add(mm[4]);
          if (mm[7] !== undefined) line = `${head} { return ${mm[7]}; }`;
          else if (mm[8] !== undefined) line = `${head} { ${mm[8]} }`;
          else { line = head + (mm[9] ? ' {' : ''); pending = { kind: 'method', method: loc }; }
          meta = { cls: meta.cls, method: loc, skip: head.length };
        } else if ((m = line.match(RE_DECL)) && !NOT_TYPE.has(m[2]) && !/^(if|while|for|switch|lock|catch|foreach)$/.test(m[2])) {
          method.locals.add(m[3]);
          line = line.replace(RE_DECL, '$1let $3$4').replace(/=\s*\{([^}]*)\}\s*;/, '= [$1];');
        }
      }
      // brace bookkeeping
      for (const ch of line) {
        if (ch === '{') {
          const e = pending || { kind: 'block' }; pending = null;
          stack.push(e);
          if (e.kind === 'method' && e.needSup) { line = line.replace(/\{\s*$/, '{' + e.needSup); }
          if (e.kind === 'iface') iface = 1;
        } else if (ch === '}') stack.pop();
      }
      out.push({ text: line, meta });
    }

    // qualify bare member names with this. / ClassName.
    const body = out.map(o => {
      let t = o.text, head = '';
      if (o.meta && o.meta.skip) { head = t.slice(0, o.meta.skip); t = t.slice(o.meta.skip); }
      if (o.meta && o.meta.cls) {
        const { cls, method } = o.meta;
        for (const [name, info] of Object.entries(cls.members)) {
          if (method.params.has(name) || method.locals.has(name)) continue;
          const re = new RegExp('(?<![\\w.$\\u0001])' + name + '(?!\\w)', 'g');
          t = t.replace(re, () => (info.static ? cls.name : 'this') + '.' + name);
        }
      }
      return head + t;
    }).join('\n');

    let js = body.replace(/\u0001(\d+)\u0002/g, (_, i) => lits[+i]);
    if (hasClass) {
      if (!mainClass) return { error: 'No entry point: add a  static void Main()  method.' };
      js += `\n${mainClass}.Main([]);`;
    }
    try { new Function(js); } catch (e) { return { error: 'Compile error: ' + e.message, js }; }
    return { js };
  }

  /* what the translated program can use (runs inside a Web Worker) */
  const RUNTIME = `
'use strict';
let __line = '';
const __out = s => postMessage({ t: 'out', s });
function CS_S(x) { if (x === true) return 'True'; if (x === false) return 'False'; if (x == null) return ''; return String(x); }
function CS_F(x, f) { const n = +f.slice(1) || 0, k = f[0].toUpperCase(); return k === 'F' ? Number(x).toFixed(n) : k === 'N' ? Number(x).toLocaleString('en-US', { minimumFractionDigits: n, maximumFractionDigits: n }) : String(x).padStart(n, '0'); }
function CS_Int(x) { return Math.trunc(x); }
function CS_Num(x) { const n = Number(x); if (x === '' || Number.isNaN(n)) throw new FormatException('Input string was not in a correct format.'); return n; }
function CS_Join(sep, a) { return Array.from(a).map(CS_S).join(sep); }
function CS_IsNullOrEmpty(s) { return s == null || s === ''; }
class Exception extends Error { constructor(m) { super(m); this.name = new.target.name; } }
class ArgumentException extends Exception {} class InvalidOperationException extends Exception {} class FormatException extends Exception {} class NotImplementedException extends Exception {}
class DivideByZeroException extends Exception {} class IndexOutOfRangeException extends Exception {}
const Console = {
  Write: (...a) => { __line += CS_S(a[0]); },
  WriteLine: (...a) => { let s = a.length ? CS_S(a[0]) : ''; if (a.length > 1 && typeof a[0] === 'string') s = a[0].replace(/\\{(\\d+)\\}/g, (_, i) => CS_S(a[+i + 1])); __out(__line + s); __line = ''; },
  ReadLine: () => null,
};
const CMath = { PI: Math.PI, E: Math.E, Sqrt: Math.sqrt, Pow: Math.pow, Abs: Math.abs, Max: Math.max, Min: Math.min, Floor: Math.floor, Ceiling: Math.ceil,
  Round: x => { const r = Math.round(x); return Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : r; }, Sin: Math.sin, Cos: Math.cos, Tan: Math.tan, Log: Math.log, Log10: Math.log10, Exp: Math.exp, Sign: Math.sign, Truncate: Math.trunc };
class Random { Next(a, b) { if (b === undefined) { b = a; a = 0; } return a + Math.floor(Math.random() * (b - a)); } NextDouble() { return Math.random(); } }
const World = new Proxy({}, { get: (_, fn) => (...args) => postMessage({ t: 'world', fn, args }) });
const __def = (proto, name, desc) => Object.defineProperty(proto, name, Object.assign({ configurable: true }, desc));
__def(Object.prototype, 'ToString', { value() { return CS_S(this); } });
__def(Error.prototype, 'Message', { get() { return this.message; } });
for (const P of [String.prototype, Array.prototype]) __def(P, 'Length', { get() { return this.length; } });
__def(Array.prototype, 'Count', { get() { return this.length; } });
Object.entries({ Add(x) { this.push(x); }, Contains(x) { return this.includes(x); }, Remove(x) { const i = this.indexOf(x); if (i < 0) return false; this.splice(i, 1); return true; }, RemoveAt(i) { this.splice(i, 1); },
  Clear() { this.length = 0; }, Insert(i, x) { this.splice(i, 0, x); }, IndexOf(x) { return this.indexOf(x); }, Sort() { this.sort((a, b) => a < b ? -1 : a > b ? 1 : 0); } }).forEach(([k, v]) => __def(Array.prototype, k, { value: v }));
Object.entries({ ToUpper() { return this.toUpperCase(); }, ToLower() { return this.toLowerCase(); }, Contains(x) { return this.includes(x); }, StartsWith(x) { return this.startsWith(x); },
  EndsWith(x) { return this.endsWith(x); }, Trim() { return this.trim(); }, Replace(a, b) { return this.split(a).join(b); }, Substring(i, n) { return n === undefined ? this.substring(i) : this.substr(i, n); },
  Split(s) { return this.split(s); }, IndexOf(x) { return this.indexOf(x); }, PadLeft(n, c = ' ') { return this.padStart(n, c); }, PadRight(n, c = ' ') { return this.padEnd(n, c); } }).forEach(([k, v]) => __def(String.prototype, k, { value: v }));
`;

  window.CSharp = { compile, RUNTIME };
})();
