const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".gltf": "model/gltf+json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".bin": "application/octet-stream",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ktx2": "image/ktx2",
  ".txt": "text/plain; charset=utf-8",
  ".zip": "application/zip"
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Некорректный URL");
  }

  const relativePath = pathname === "/" ? "gta67.html" : pathname.replace(/^\\/+/, "");
  const filePath = path.resolve(__dirname, relativePath);
  const projectRoot = path.resolve(__dirname);

  // Never allow a URL to escape the project directory.
  if (filePath !== projectRoot && !filePath.startsWith(projectRoot + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Доступ запрещён");
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Файл не найден: " + pathname);
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extension] || "application/octet-stream";
    const isGameHtml = path.basename(filePath).toLowerCase() === "gta67.html";
    const cacheControl = isGameHtml ? "no-cache" : "public, max-age=3600";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff"
    });

    if (req.method === "HEAD") return res.end();

    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      if (!res.headersSent) res.writeHead(500);
      res.end("Ошибка чтения файла");
    });
    stream.pipe(res);
  });
});

const wss = new WebSocketServer({ server });

// roomId -> { id, title, max, players: Map<clientId, { ws, nick, x, y, z, yaw, speed, aiming, inCar, outfit }>, houses: {}, cycleStart: number }
const rooms = new Map();
let nextClientId = 1;

function getPublicRoomsList() {
  const list = [];
  for (const r of rooms.values()) {
    if (r.players.size > 0) {
      list.push({ id: r.id, title: r.title, count: r.players.size, max: r.max });
    }
  }
  return list;
}

function broadcastRoomsList() {
  const payload = JSON.stringify({ type: "rooms_list", rooms: getPublicRoomsList() });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

function broadcastToRoom(room, payloadObj, exceptId = null) {
  const raw = JSON.stringify(payloadObj);
  for (const [cid, p] of room.players.entries()) {
    if (cid !== exceptId && p.ws.readyState === 1) {
      p.ws.send(raw);
    }
  }
}

function isNickTaken(room, nick, exceptClientId = null) {
  const target = nick.trim().toLowerCase();
  for (const [cid, p] of room.players.entries()) {
    if (cid !== exceptClientId && p.nick.trim().toLowerCase() === target) return true;
  }
  return false;
}

function generateFreeNick(room) {
  for (let i = 0; i < 200; i++) {
    const candidate = "Player_" + Math.floor(1000 + Math.random() * 9000);
    if (!isNickTaken(room, candidate)) return candidate;
  }
  return "Player_" + Date.now().toString().slice(-5);
}

function leaveCurrentRoom(clientState) {
  const { roomId, id } = clientState;
  if (!roomId) return;
  const room = rooms.get(roomId);
  clientState.roomId = null;
  if (!room) return;

  room.players.delete(id);
  broadcastToRoom(room, { type: "player_left", id });

  if (room.players.size === 0) {
    rooms.delete(roomId);
  }
  broadcastRoomsList();
}

wss.on("connection", (ws) => {
  const clientState = { id: "p_" + (nextClientId++), roomId: null };
  ws.send(JSON.stringify({ type: "welcome", id: clientState.id, rooms: getPublicRoomsList() }));

  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    if (msg.type === "get_rooms") {
      ws.send(JSON.stringify({ type: "rooms_list", rooms: getPublicRoomsList() }));
      return;
    }

    if (msg.type === "create_or_join") {
      leaveCurrentRoom(clientState);
      const roomId = (msg.roomId || ("leonida-" + Math.floor(1000 + Math.random() * 9000))).trim();
      let room = rooms.get(roomId);

      if (!room) {
        room = {
          id: roomId,
          title: msg.title || `Сервер ${roomId}`,
          max: 15,
          players: new Map(),
          houses: {}, // houseIdx -> nick
          cycleStart: Date.now()
        };
        rooms.set(roomId, room);
      }

      if (room.players.size >= room.max) {
        ws.send(JSON.stringify({ type: "join_error", reason: "Сервер заполнен (15/15)" }));
        return;
      }

      let finalNick = (msg.nick || "").trim();
      if (!finalNick || isNickTaken(room, finalNick)) {
        finalNick = generateFreeNick(room);
      }

      clientState.roomId = roomId;
      const playerObj = {
        ws,
        id: clientState.id,
        nick: finalNick,
        x: 60, y: 0.15, z: -20, yaw: 0, speed: 0, aiming: false, inCar: false,
        outfit: msg.outfit || "street"
      };
      room.players.set(clientState.id, playerObj);

      const others = [];
      for (const [cid, p] of room.players.entries()) {
        if (cid !== clientState.id) {
          others.push({ id: cid, nick: p.nick, x: p.x, y: p.y, z: p.z, yaw: p.yaw, outfit: p.outfit, inCar: p.inCar });
        }
      }

      ws.send(JSON.stringify({
        type: "joined",
        roomId: room.id,
        title: room.title,
        yourId: clientState.id,
        yourNick: finalNick,
        houses: room.houses,
        cycleStart: room.cycleStart,
        players: others
      }));

      broadcastToRoom(room, {
        type: "player_joined",
        player: { id: clientState.id, nick: finalNick, x: 60, y: 0.15, z: -20, yaw: 0, outfit: playerObj.outfit }
      }, clientState.id);

      broadcastRoomsList();
      return;
    }

    const room = clientState.roomId ? rooms.get(clientState.roomId) : null;
    if (!room) return;
    const me = room.players.get(clientState.id);
    if (!me) return;

    if (msg.type === "change_nick") {
      const nextNick = (msg.nick || "").trim().slice(0, 16);
      if (nextNick.length < 2) {
        ws.send(JSON.stringify({ type: "nick_result", ok: false, reason: "Ник слишком короткий" }));
        return;
      }
      if (isNickTaken(room, nextNick, clientState.id)) {
        ws.send(JSON.stringify({ type: "nick_result", ok: false, reason: "Этот ник уже занят на сервере!" }));
        return;
      }
      const oldNick = me.nick;
      me.nick = nextNick;
      // Обновляем ник владельца на купленных им домах
      for (const hIdx of Object.keys(room.houses)) {
        if (room.houses[hIdx] === oldNick) room.houses[hIdx] = nextNick;
      }
      ws.send(JSON.stringify({ type: "nick_result", ok: true, nick: nextNick }));
      broadcastToRoom(room, { type: "player_nick", id: clientState.id, nick: nextNick, houses: room.houses });
      return;
    }

    if (msg.type === "buy_house") {
      const idx = String(msg.houseIdx);
      if (room.houses[idx]) {
        ws.send(JSON.stringify({ type: "house_error", reason: `Дом уже купил ${room.houses[idx]}` }));
        return;
      }
      room.houses[idx] = me.nick;
      broadcastToRoom(room, { type: "houses_update", houses: room.houses });
      return;
    }

    if (msg.type === "state") {
      me.x = msg.x; me.y = msg.y; me.z = msg.z; me.yaw = msg.yaw;
      me.speed = msg.speed; me.aiming = msg.aiming; me.inCar = msg.inCar;
      if (msg.outfit) me.outfit = msg.outfit;
      broadcastToRoom(room, { ...msg, id: clientState.id }, clientState.id);
      return;
    }

    if (msg.type === "shot" || msg.type === "car_sync" || msg.type === "outfit") {
      broadcastToRoom(room, { ...msg, id: clientState.id }, clientState.id);
    }
  });

  ws.on("close", () => leaveCurrentRoom(clientState));
});

server.listen(PORT, () => {
  console.log("Leonida server listening on port", PORT);
});
