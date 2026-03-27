import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // API routes go here
  app.get("/api/config", (req, res) => {
    res.json({ 
      publicUrl: process.env.SHARED_APP_URL || process.env.APP_URL || "" 
    });
  });

  // Global stats
  let onlineCount = 0;

  // Game state storage (in-memory for now)
  const rooms = new Map();

  io.on("connection", (socket) => {
    onlineCount++;
    io.emit("online-count", onlineCount);
    console.log("User connected:", socket.id, "Total:", onlineCount);

    socket.on("join-room", (roomId) => {
      socket.join(roomId);
      console.log(`User ${socket.id} joined room ${roomId}`);
      
      // If room doesn't exist, initialize it
      if (!rooms.has(roomId)) {
        rooms.set(roomId, {
          players: [],
          gameState: null
        });
      }

      const room = rooms.get(roomId);
      
      // Assign player role if not already assigned
      let role = null;
      if (room.players.length === 0) {
        role = "TIGER";
        room.players.push({ id: socket.id, role });
      } else if (room.players.length === 1) {
        role = "GOAT";
        room.players.push({ id: socket.id, role });
      }

      socket.emit("room-joined", { role, gameState: room.gameState });
      
      // Notify others in room
      socket.to(roomId).emit("player-joined", { role });
    });

    socket.on("move", ({ roomId, move, gameState }) => {
      const room = rooms.get(roomId);
      if (room) {
        room.gameState = gameState;
        socket.to(roomId).emit("move-made", { move, gameState });
      }
    });

    socket.on("reset", (roomId) => {
      const room = rooms.get(roomId);
      if (room) {
        room.gameState = null;
        socket.to(roomId).emit("game-reset");
      }
    });

    socket.on("disconnect", () => {
      onlineCount--;
      io.emit("online-count", onlineCount);
      console.log("User disconnected:", socket.id, "Total:", onlineCount);
      // Clean up rooms if needed
      for (const [roomId, room] of rooms.entries()) {
        const index = room.players.findIndex(p => p.id === socket.id);
        if (index !== -1) {
          room.players.splice(index, 1);
          if (room.players.length === 0) {
            rooms.delete(roomId);
          } else {
            socket.to(roomId).emit("player-left");
          }
        }
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
