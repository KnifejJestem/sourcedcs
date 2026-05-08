'use strict';

const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const config = require('./config.json');

const IS_LINUX = process.platform === 'linux';
const IS_WIN   = process.platform === 'win32';

let nodeProc = null;
let pyProc   = null;
let win      = null;

// ── Helpers ───────────────────────────────────────────────────────────────
function logLines(prefix, stream) {
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
        chunk.split('\n').filter(Boolean).forEach(line => console.log(`[${prefix}] ${line}`));
    });
}

// ── Process launchers ─────────────────────────────────────────────────────

function spawnLxsrs() {
    const freqArgs = config.freqs.flatMap(f => ['--freq', f]);

    const proc = spawn('python3', [
        '-m', 'lxsrs_v2',
        ...freqArgs,
        '--tx-freq',  config.txFreq,
        '--host',     config.srsHost,
        '--port',     String(config.srsPort),
        '--play-audio',
        '--api-port', String(config.srsApiPort),
    ], {
        cwd: path.join(__dirname),
        env: {
            ...process.env,
            PYTHONPATH: path.join(__dirname, 'python-pkg'),
        },
    });

    logLines('lxsrs', proc.stdout);
    logLines('lxsrs', proc.stderr);
    proc.on('exit', code => console.log(`[lxsrs] exited (${code})`));
    return proc;
}


// ── App lifecycle ─────────────────────────────────────────────────────────

app.on('ready', async () => {
    if (IS_LINUX) {
        pyProc = spawnLxsrs();
    }

    // set env vars that server.js reads
    process.env.DCS_GRPC_HOST            = config.dcsGrpcHost;
    process.env.DCS_GRPC_PROTO_PATH      = path.join(__dirname, 'app', 'protos');
    process.env.DCS_GRPC_POLL_RATE       = String(config.dcsGrpcPollRate ?? 0);
    process.env.SRS_HOST                 = config.srsHost;
    process.env.SRS_PORT                 = String(config.srsPort);
    process.env.SRS_RADIO_API_PORT       = String(config.srsApiPort);
    process.env.WS_PORT                  = String(config.wsPort);
    process.env.WS_BROADCAST_INTERVAL_MS = String(config.wsBroadcastIntervalMs);
    process.env.SOURCEDCS_WEB_URL        = config.sourcedcsWebUrl || '';

    require('./app/server.js');

    win = new BrowserWindow({
        width:  1400,
        height: 900,
        title:  'CRC',
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
        },
    });

    win.webContents.on('did-finish-load', () => {
        win.webContents.insertCSS('* { outline: none !important; }');
    });

    win.loadURL(`http://localhost:${config.wsPort}`);
    win.on('closed', () => { win = null; });


});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('before-quit', () => {
    pyProc?.kill();
});