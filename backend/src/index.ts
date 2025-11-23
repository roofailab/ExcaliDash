import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { createServer } from "http";
import { Server } from "socket.io";
import multer from "multer";
import archiver from "archiver";
// @ts-ignore
import { PrismaClient } from "./generated/client";

dotenv.config();

// Ensure DATABASE_URL always points to an absolute path when using SQLite.
// Respect externally provided values and only fall back to the dev database when unset.
const backendRoot = path.resolve(__dirname, "../");
const defaultDbPath = path.resolve(backendRoot, "prisma/dev.db");
const resolveDatabaseUrl = (rawUrl?: string) => {
  if (!rawUrl || rawUrl.trim().length === 0) {
    return `file:${defaultDbPath}`;
  }

  if (!rawUrl.startsWith("file:")) {
    return rawUrl;
  }

  const filePath = rawUrl.replace(/^file:/, "");
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(backendRoot, filePath);

  return `file:${absolutePath}`;
};

process.env.DATABASE_URL = resolveDatabaseUrl(process.env.DATABASE_URL);
console.log("Resolved DATABASE_URL:", process.env.DATABASE_URL);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
  maxHttpBufferSize: 1e8, // 100 MB
});
const prisma = new PrismaClient();
const PORT = process.env.PORT || 8000;

// Multer setup for file uploads
const upload = multer({ dest: "uploads/" });

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Socket.io Logic
interface User {
  id: string;
  name: string;
  initials: string;
  color: string;
  socketId: string;
  isActive: boolean;
}

const roomUsers = new Map<string, User[]>();

io.on("connection", (socket) => {
  socket.on(
    "join-room",
    ({
      drawingId,
      user,
    }: {
      drawingId: string;
      user: Omit<User, "socketId" | "isActive">;
    }) => {
      const roomId = `drawing_${drawingId}`;
      socket.join(roomId);

      const newUser: User = { ...user, socketId: socket.id, isActive: true };

      const currentUsers = roomUsers.get(roomId) || [];
      const filteredUsers = currentUsers.filter((u) => u.id !== user.id);
      filteredUsers.push(newUser);
      roomUsers.set(roomId, filteredUsers);

      io.to(roomId).emit("presence-update", filteredUsers);
    }
  );

  socket.on("cursor-move", (data) => {
    const roomId = `drawing_${data.drawingId}`;
    // Use volatile for high-frequency, low-importance updates (cursors)
    // If network is congested, drop these packets
    socket.volatile.to(roomId).emit("cursor-move", data);
  });

  socket.on("element-update", (data) => {
    const roomId = `drawing_${data.drawingId}`;
    socket.to(roomId).emit("element-update", data);
  });

  socket.on(
    "user-activity",
    ({ drawingId, isActive }: { drawingId: string; isActive: boolean }) => {
      const roomId = `drawing_${drawingId}`;
      const users = roomUsers.get(roomId);
      if (users) {
        const user = users.find((u) => u.socketId === socket.id);
        if (user) {
          user.isActive = isActive;
          io.to(roomId).emit("presence-update", users);
        }
      }
    }
  );

  socket.on("disconnect", () => {
    roomUsers.forEach((users, roomId) => {
      const index = users.findIndex((u) => u.socketId === socket.id);
      if (index !== -1) {
        users.splice(index, 1);
        roomUsers.set(roomId, users);
        io.to(roomId).emit("presence-update", users);
      }
    });
  });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// --- Drawings ---

// GET /drawings
app.get("/drawings", async (req, res) => {
  try {
    const { search, collectionId } = req.query;
    const where: any = {};

    if (search) {
      where.name = { contains: String(search) };
    }

    if (collectionId === "null") {
      where.collectionId = null;
    } else if (collectionId) {
      where.collectionId = String(collectionId);
    } else {
      // Default: Exclude trash, but include unorganized (null)
      where.OR = [{ collectionId: { not: "trash" } }, { collectionId: null }];
    }

    const drawings = await prisma.drawing.findMany({
      where,
      orderBy: { updatedAt: "desc" },
    });

    // Parse JSON strings for response
    const parsedDrawings = drawings.map((d: any) => ({
      ...d,
      elements: JSON.parse(d.elements),
      appState: JSON.parse(d.appState),
      files: JSON.parse(d.files || "{}"),
    }));

    res.json(parsedDrawings);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch drawings" });
  }
});

// GET /drawings/:id
app.get("/drawings/:id", async (req, res) => {
  try {
    const { id } = req.params;
    console.log("[API] Fetching drawing", { id });
    const drawing = await prisma.drawing.findUnique({ where: { id } });

    if (!drawing) {
      console.warn("[API] Drawing not found", { id });
      return res.status(404).json({ error: "Drawing not found" });
    }

    console.log("[API] Returning drawing", {
      id,
      elementCount: (() => {
        try {
          const parsed = JSON.parse(drawing.elements);
          return Array.isArray(parsed) ? parsed.length : null;
        } catch (_err) {
          return null;
        }
      })(),
    });

    res.json({
      ...drawing,
      elements: JSON.parse(drawing.elements),
      appState: JSON.parse(drawing.appState),
      files: JSON.parse(drawing.files || "{}"),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch drawing" });
  }
});

// POST /drawings
app.post("/drawings", async (req, res) => {
  try {
    const { name, elements, appState, collectionId, preview, files } = req.body;

    const newDrawing = await prisma.drawing.create({
      data: {
        name,
        elements: JSON.stringify(elements || []),
        appState: JSON.stringify(appState || {}),
        collectionId: collectionId || null,
        preview: preview || null,
        files: JSON.stringify(files || {}),
      },
    });

    res.json({
      ...newDrawing,
      elements: JSON.parse(newDrawing.elements),
      appState: JSON.parse(newDrawing.appState),
      files: JSON.parse(newDrawing.files || "{}"),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to create drawing" });
  }
});

// PUT /drawings/:id
app.put("/drawings/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, elements, appState, collectionId, preview, files } = req.body;

    console.log("[API] Updating drawing", {
      id,
      hasElements: elements !== undefined,
      elementCount:
        elements && Array.isArray(elements) ? elements.length : undefined,
      hasAppState: appState !== undefined,
      hasFiles: files !== undefined,
      hasPreview: preview !== undefined,
    });

    const data: any = {
      version: { increment: 1 },
    };

    if (name !== undefined) data.name = name;
    if (elements !== undefined) data.elements = JSON.stringify(elements);
    if (appState !== undefined) data.appState = JSON.stringify(appState);
    if (files !== undefined) data.files = JSON.stringify(files);
    if (collectionId !== undefined) data.collectionId = collectionId;
    if (preview !== undefined) data.preview = preview;

    const updatedDrawing = await prisma.drawing.update({
      where: { id },
      data,
    });

    console.log("[API] Update complete", {
      id,
      storedElementCount: (() => {
        try {
          const parsed = JSON.parse(updatedDrawing.elements);
          return Array.isArray(parsed) ? parsed.length : null;
        } catch (_err) {
          return null;
        }
      })(),
    });

    res.json({
      ...updatedDrawing,
      elements: JSON.parse(updatedDrawing.elements),
      appState: JSON.parse(updatedDrawing.appState),
      files: JSON.parse(updatedDrawing.files || "{}"),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to update drawing" });
  }
});

// DELETE /drawings/:id
app.delete("/drawings/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.drawing.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete drawing" });
  }
});

// POST /drawings/:id/duplicate
app.post("/drawings/:id/duplicate", async (req, res) => {
  try {
    const { id } = req.params;
    const original = await prisma.drawing.findUnique({ where: { id } });

    if (!original) {
      return res.status(404).json({ error: "Original drawing not found" });
    }

    const newDrawing = await prisma.drawing.create({
      data: {
        name: `${original.name} (Copy)`,
        elements: original.elements,
        appState: original.appState,
        files: original.files,
        collectionId: original.collectionId,
        version: 1,
      },
    });

    res.json({
      ...newDrawing,
      elements: JSON.parse(newDrawing.elements),
      appState: JSON.parse(newDrawing.appState),
      files: JSON.parse(newDrawing.files || "{}"),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to duplicate drawing" });
  }
});

// --- Collections ---

// GET /collections
app.get("/collections", async (req, res) => {
  try {
    const collections = await prisma.collection.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json(collections);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch collections" });
  }
});

// POST /collections
app.post("/collections", async (req, res) => {
  try {
    const { name } = req.body;
    const newCollection = await prisma.collection.create({
      data: { name },
    });
    res.json(newCollection);
  } catch (error) {
    res.status(500).json({ error: "Failed to create collection" });
  }
});

// PUT /collections/:id
app.put("/collections/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const updatedCollection = await prisma.collection.update({
      where: { id },
      data: { name },
    });
    res.json(updatedCollection);
  } catch (error) {
    res.status(500).json({ error: "Failed to update collection" });
  }
});

// DELETE /collections/:id
app.delete("/collections/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Transaction: Unlink drawings, then delete collection
    await prisma.$transaction([
      prisma.drawing.updateMany({
        where: { collectionId: id },
        data: { collectionId: null },
      }),
      prisma.collection.delete({
        where: { id },
      }),
    ]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete collection" });
  }
});

// --- Export/Import Endpoints ---

// GET /export - Export SQLite database
app.get("/export", async (req, res) => {
  try {
    const dbPath = path.resolve(__dirname, "../prisma/dev.db");

    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({ error: "Database file not found" });
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="excalidash-db-${
        new Date().toISOString().split("T")[0]
      }.sqlite"`
    );

    const fileStream = fs.createReadStream(dbPath);
    fileStream.pipe(res);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to export database" });
  }
});

// GET /export/json - Export drawings as ZIP of .excalidraw files
app.get("/export/json", async (req, res) => {
  try {
    const drawings = await prisma.drawing.findMany({
      include: {
        collection: true,
      },
    });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="excalidraw-drawings-${
        new Date().toISOString().split("T")[0]
      }.zip"`
    );

    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("error", (err) => {
      console.error("Archive error:", err);
      res.status(500).json({ error: "Failed to create archive" });
    });

    archive.pipe(res);

    // Group drawings by collection
    const drawingsByCollection: { [key: string]: any[] } = {};

    drawings.forEach((drawing: any) => {
      const collectionName = drawing.collection?.name || "Unorganized";
      if (!drawingsByCollection[collectionName]) {
        drawingsByCollection[collectionName] = [];
      }

      const drawingData = {
        elements: JSON.parse(drawing.elements),
        appState: JSON.parse(drawing.appState),
        files: JSON.parse(drawing.files || "{}"),
      };

      drawingsByCollection[collectionName].push({
        name: drawing.name,
        data: drawingData,
      });
    });

    // Create folders and add files
    Object.entries(drawingsByCollection).forEach(
      ([collectionName, collectionDrawings]) => {
        const folderName = collectionName.replace(/[<>:"/\\|?*]/g, "_"); // Sanitize folder name
        collectionDrawings.forEach((drawing, index) => {
          const fileName = `${drawing.name.replace(
            /[<>:"/\\|?*]/g,
            "_"
          )}.excalidraw`;
          const filePath = `${folderName}/${fileName}`;

          archive.append(JSON.stringify(drawing.data, null, 2), {
            name: filePath,
          });
        });
      }
    );

    // Add a readme file
    const readmeContent = `ExcaliDash Export

This archive contains your ExcaliDash drawings organized by collection folders.

Structure:
- Each collection has its own folder
- Each drawing is saved as a .excalidraw file
- Files can be imported back into ExcaliDash

Export Date: ${new Date().toISOString()}
Total Collections: ${Object.keys(drawingsByCollection).length}
Total Drawings: ${drawings.length}

Collections:
${Object.entries(drawingsByCollection)
  .map(([name, drawings]) => `- ${name}: ${drawings.length} drawings`)
  .join("\n")}
`;

    archive.append(readmeContent, { name: "README.txt" });

    await archive.finalize();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to export drawings" });
  }
});

// POST /import/sqlite/verify - Verify SQLite database before import
app.post("/import/sqlite/verify", upload.single("db"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Basic verification: check if it's a SQLite file
    const buffer = fs.readFileSync(req.file.path);
    const header = buffer.slice(0, 16).toString("ascii");

    if (!header.startsWith("SQLite format 3")) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Invalid SQLite file" });
    }

    // Additional verification could be added here
    // For now, we'll just check the file signature

    fs.unlinkSync(req.file.path);
    res.json({ valid: true, message: "Database file is valid" });
  } catch (error) {
    console.error(error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: "Failed to verify database file" });
  }
});

// POST /import/sqlite - Import SQLite database
app.post("/import/sqlite", upload.single("db"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const dbPath = path.resolve(__dirname, "../prisma/dev.db");

    // Backup current database
    if (fs.existsSync(dbPath)) {
      const backupPath = path.resolve(__dirname, "../prisma/dev.db.backup");
      fs.copyFileSync(dbPath, backupPath);
    }

    // Replace database file
    fs.copyFileSync(req.file.path, dbPath);
    fs.unlinkSync(req.file.path);

    // Reinitialize Prisma client
    await prisma.$disconnect();

    res.json({ success: true, message: "Database imported successfully" });
  } catch (error) {
    console.error(error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: "Failed to import database" });
  }
});

// Ensure Trash collection exists
const ensureTrashCollection = async () => {
  try {
    const trash = await prisma.collection.findUnique({
      where: { id: "trash" },
    });
    if (!trash) {
      await prisma.collection.create({
        data: { id: "trash", name: "Trash" },
      });
      console.log("Created Trash collection");
    }
  } catch (error) {
    console.error("Failed to ensure Trash collection:", error);
  }
};

httpServer.listen(PORT, async () => {
  await ensureTrashCollection();
  console.log(`Server running on port ${PORT}`);
});
