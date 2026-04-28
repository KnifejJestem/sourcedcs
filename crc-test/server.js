const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const WebSocket = require('ws');
const path = require('path');

const PROTO_PATH = '/home/nklx/Downloads/DCS-gRPC-0.8.1/Docs/DCS-gRPC/protos';
const DCS_HOST = 'server.sourcedcs.page:50051';

const packageDef = protoLoader.loadSync(
    path.join(PROTO_PATH, 'dcs/mission/v0/mission.proto'),
    { keepCase: true, includeDirs: [PROTO_PATH] }
);
const proto = grpc.loadPackageDefinition(packageDef);
const MissionService = proto.dcs.mission.v0.MissionService;

const client = new MissionService(DCS_HOST, grpc.credentials.createInsecure());

const units = new Map();

function startStream() {
    const stream = client.StreamUnits({
        poll_rate: 1,
        category: 'GROUP_CATEGORY_UNSPECIFIED'
    });

    stream.on('data', (response) => {
        if (response.unit) {
            const u = response.unit;
            units.set(u.id, {
                id: u.id,
                name: u.name,
                callsign: u.callsign,
                coalition: u.coalition,
                type: u.type,
                lat: u.position.lat,
                lon: u.position.lon,
                alt: Math.round(u.position.alt),
                heading: u.orientation.heading,
                speed: Math.round(u.velocity.speed),
                player: u.player_name || null,
                group: u.group.name
            });
        }
        if (response.gone) {
            units.delete(response.gone.id);
        }
    });

    stream.on('error', (err) => {
        console.error('gRPC stream error:', err.message);
        setTimeout(startStream, 3000);
    });

    stream.on('end', () => {
        console.log('gRPC stream ended, reconnecting...');
        setTimeout(startStream, 3000);
    });

    console.log('gRPC stream started');
}

const wss = new WebSocket.Server({ port: 3000 });

wss.on('connection', (ws) => {
    console.log('client connected');
    ws.send(JSON.stringify({ type: 'snapshot', units: Array.from(units.values()) }));
    ws.on('close', () => console.log('client disconnected'));
});

setInterval(() => {
    if (wss.clients.size === 0) return;
    const msg = JSON.stringify({ type: 'snapshot', units: Array.from(units.values()) });
    wss.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
}, 500);

startStream();
console.log('WebSocket server listening on ws://localhost:3000');