/* Minimal Lua table-literal parser, aimed at DCS weapon definition files.
   Handles the dialect these files actually use:
     - key = value, ["key"] = value, [3] = value, and positional array items
     - numbers incl. scientific (8e-05) and negatives, strings, true/false/nil
     - nested tables, trailing commas, ; separators
     - line comments (--) and block comments (--[[ ]])
     - the serializer forms <N>{...} (labelled table) and <table N> (a
       back-reference to it), which appear in dumped tables
     - top-level `a.b["c"] = {...}` assignments and `declare_weapon({...})`
       style function calls
   It is deliberately not a general Lua interpreter: expressions, function
   bodies and concatenation are not evaluated. */

export function tokenizeLua(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  const isIdStart = (c) => /[A-Za-z_]/.test(c);
  const isId = (c) => /[A-Za-z0-9_]/.test(c);

  while (i < n) {
    const c = src[i];

    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }

    // comments
    if (c === '-' && src[i + 1] === '-') {
      if (src[i + 2] === '[' && src[i + 3] === '[') {
        const end = src.indexOf(']]', i + 4);
        i = end === -1 ? n : end + 2;
      } else {
        const nl = src.indexOf('\n', i);
        i = nl === -1 ? n : nl + 1;
      }
      continue;
    }

    // long-bracket string [[...]]
    if (c === '[' && src[i + 1] === '[') {
      const end = src.indexOf(']]', i + 2);
      const raw = src.slice(i + 2, end === -1 ? n : end);
      toks.push({ t: 'str', v: raw });
      i = end === -1 ? n : end + 2;
      continue;
    }

    // serializer table markers: <1>{  or  <table 1>
    if (c === '<') {
      const close = src.indexOf('>', i);
      if (close !== -1) {
        const inner = src.slice(i + 1, close).trim();
        let m;
        if ((m = /^table\s+(\d+)$/.exec(inner))) {
          toks.push({ t: 'tableref', v: parseInt(m[1], 10) });
          i = close + 1;
          continue;
        }
        if ((m = /^(\d+)$/.exec(inner))) {
          toks.push({ t: 'tablelabel', v: parseInt(m[1], 10) });
          i = close + 1;
          continue;
        }
      }
      // not a marker we understand; skip the char so we never hard-loop
      i++;
      continue;
    }

    if (c === '"' || c === "'") {
      let j = i + 1, out = '';
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') {
          const e = src[j + 1];
          out += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          j += 2;
        } else { out += src[j]; j++; }
      }
      toks.push({ t: 'str', v: out });
      i = j + 1;
      continue;
    }

    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || '')) ||
        (c === '-' && /[0-9.]/.test(src[i + 1] || ''))) {
      const m = /^-?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(src.slice(i));
      if (m) {
        toks.push({ t: 'num', v: Number(m[0]) });
        i += m[0].length;
        continue;
      }
    }

    if (isIdStart(c)) {
      let j = i;
      while (j < n && isId(src[j])) j++;
      const word = src.slice(i, j);
      toks.push({ t: 'name', v: word });
      i = j;
      continue;
    }

    if ('{}[]=,;().:'.includes(c)) { toks.push({ t: c }); i++; continue; }

    // anything else (operators, etc.) -- emit as punct so the parser can skip
    toks.push({ t: 'punct', v: c });
    i++;
  }
  toks.push({ t: 'eof' });
  return toks;
}

export function parseLuaTables(src) {
  const toks = tokenizeLua(src);
  let p = 0;
  const labelled = new Map();          // <N> -> parsed table
  const EOF = { t: 'eof' };
  // Bounds-safe: reading past the end must yield eof, not undefined. A
  // truncated file (e.g. "x = " with nothing after) otherwise crashes here.
  const peek = (k) => toks[p + (k || 0)] || EOF;
  const at = (type) => peek().t === type;

  function parseValue() {
    const tk = peek();
    if (tk.t === 'eof') return null;

    if (tk.t === 'tablelabel') {
      p++;
      const tbl = parseValue();
      labelled.set(tk.v, tbl);
      return tbl;
    }
    if (tk.t === 'tableref') {
      p++;
      return labelled.has(tk.v) ? labelled.get(tk.v) : null;
    }
    if (tk.t === 'num') { p++; return tk.v; }
    if (tk.t === 'str') { p++; return tk.v; }
    if (tk.t === 'name') {
      p++;
      if (tk.v === 'true') return true;
      if (tk.v === 'false') return false;
      if (tk.v === 'nil') return null;
      // an identifier used as a value (a constant reference we can't resolve)
      // -- consume any trailing call/index so we stay in sync
      while (at('.') || at(':')) { p += 2; }
      if (at('(')) skipBalanced('(', ')');
      return { __unresolved: tk.v };
    }
    if (tk.t === '{') return parseTable();
    if (tk.t === '-') { p++; const v = parseValue(); return typeof v === 'number' ? -v : v; }

    p++;                                // unknown token: skip
    return null;
  }

  function skipBalanced(open, close) {
    let depth = 0;
    for (;;) {
      const t = peek().t;
      if (t === 'eof') return;
      if (t === open) depth++;
      if (t === close) { depth--; p++; if (depth === 0) return; continue; }
      p++;
    }
  }

  function parseTable() {
    p++;                                // consume {
    const obj = {};
    const arr = [];
    for (;;) {
      if (at('eof')) break;
      if (at('}')) { p++; break; }
      if (at(',') || at(';')) { p++; continue; }

      // [expr] = value
      if (at('[')) {
        p++;
        const k = parseValue();
        if (at(']')) p++;
        if (at('=')) {
          p++;
          const v = parseValue();
          if (typeof k === 'number') arr[k - 1] = v; else obj[String(k)] = v;
        }
        continue;
      }

      // name = value
      if (at('name') && peek(1).t === '=') {
        const k = peek().v;
        p += 2;
        obj[k] = parseValue();
        continue;
      }

      // positional item
      arr.push(parseValue());
    }
    if (arr.length) {
      // Expose array items both as a real array and (when there are named
      // keys too) alongside them, since DCS tables mix the two styles.
      if (Object.keys(obj).length === 0) return arr;
      obj.__array = arr;
    }
    return obj;
  }

  // ---- top level: collect every table we can attach a name to ----
  const found = [];
  let guard = 0;
  while (!at('eof') && guard++ < 500000) {
    // lvalue: name ( .name | [str] )*
    if (at('name')) {
      let label = peek().v;
      let q = p + 1;
      for (;;) {
        if (toks[q] && toks[q].t === '.' && toks[q + 1] && toks[q + 1].t === 'name') {
          label += '.' + toks[q + 1].v; q += 2; continue;
        }
        if (toks[q] && toks[q].t === '[' && toks[q + 1] &&
            (toks[q + 1].t === 'str' || toks[q + 1].t === 'num') &&
            toks[q + 2] && toks[q + 2].t === ']') {
          label += '[' + toks[q + 1].v + ']'; q += 3; continue;
        }
        break;
      }

      // assignment form:  lvalue = { ... }
      if (toks[q] && toks[q].t === '=' ) {
        p = q + 1;
        const val = parseValue();
        if (val && typeof val === 'object') found.push({ label, table: val });
        continue;
      }

      // call form:  declare_weapon({ ... })
      if (toks[q] && toks[q].t === '(') {
        p = q + 1;
        while (!at('eof') && !at(')')) {
          if (at('{') || at('tablelabel')) {
            const val = parseValue();
            if (val && typeof val === 'object') found.push({ label, table: val });
          } else p++;
        }
        if (at(')')) p++;
        continue;
      }
    }
    p++;
  }
  return found;
}
