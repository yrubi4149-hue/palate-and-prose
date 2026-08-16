const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "palate.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  );

 CREATE TABLE IF NOT EXISTS poems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  image TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
  CREATE TABLE IF NOT EXISTS paintings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    image TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);try {
  db.prepare("ALTER TABLE poems ADD COLUMN image TEXT").run();
  console.log("Poem image column added.");
} catch (err) {
  if (!err.message.includes("duplicate column name")) {
    throw err;
  }
}

const adminUsername = process.env.ADMIN_USERNAME || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "...........";

const existingAdmin = db.prepare("SELECT id FROM admins WHERE username = ?").get(adminUsername);

if (!existingAdmin) {
  const hash = bcrypt.hashSync(adminPassword, 12);
  db.prepare("INSERT INTO admins (username, password_hash) VALUES (?, ?)")
    .run(adminUsername, hash);

  console.log(`Admin account created for username "${adminUsername}".`);

  if (!process.env.ADMIN_PASSWORD) {
    console.log("IMPORTANT: Change the default password using ADMIN_PASSWORD before deploying.");
  }
} else if (process.env.ADMIN_PASSWORD) {
  const hash = bcrypt.hashSync(adminPassword, 12);
  db.prepare("UPDATE admins SET password_hash = ? WHERE username = ?")
    .run(hash, adminUsername);

  console.log(`Admin password updated for "${adminUsername}".`);
}

app.use(express.json());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-session-secret",
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 1000 * 60 * 60 * 4
  }
}));
app.use(express.static(path.join(ROOT, "public")));
app.use("/uploads", express.static(UPLOAD_DIR));

function requireAdmin(req, res, next) {
  if (!req.session.adminId) {
    return res.status(401).json({ error: "Admin login required." });
  }
  next();
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeBase = path.basename(file.originalname, ext)
      .replace(/[^a-z0-9-_]/gi, "-")
      .slice(0, 50);
    cb(null, `${Date.now()}-${safeBase || "painting"}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    cb(null, allowed.includes(file.mimetype));
  }
});

// Auth
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  const admin = db.prepare("SELECT * FROM admins WHERE username = ?").get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: "Invalid username or password." });
  }

  req.session.adminId = admin.id;
  req.session.adminUsername = admin.username;
  res.json({ ok: true, username: admin.username });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/session", (req, res) => {
  res.json({
    loggedIn: Boolean(req.session.adminId),
    username: req.session.adminUsername || null
  });
});

// Public content
app.get("/api/poems", (_req, res) => {
  const poems = db.prepare("SELECT * FROM poems ORDER BY id DESC").all();
  res.json(poems);
});

app.get("/api/paintings", (_req, res) => {
  const paintings = db.prepare("SELECT * FROM paintings ORDER BY id DESC").all();
  res.json(paintings);
});

// Admin poem management
app.post("/api/poems", requireAdmin, (req, res) => {
  const { title, author, content, poemImage } = req.body;

  if (!title || !author || !content) {
    return res.status(400).json({
      error: "Title, author and poem content are required."
    });
  }

  let image = null;

  // Save pasted poem image
  if (poemImage) {
    const match = poemImage.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/);

    if (!match) {
      return res.status(400).json({
        error: "Invalid poem image."
      });
    }

    const extension = match[1] === "jpeg" || match[1] === "jpg"
      ? "jpg"
      : match[1];

    const filename = `${Date.now()}-poem.${extension}`;
    const filePath = path.join(UPLOAD_DIR, filename);

    fs.writeFileSync(
      filePath,
      Buffer.from(match[2], "base64")
    );

    image = `/uploads/${filename}`;
  }

  const result = db.prepare(
    "INSERT INTO poems (title, author, content, image) VALUES (?, ?, ?, ?)"
  ).run(
    title.trim(),
    author.trim(),
    content.trim(),
    image
  );

  res.status(201).json(
    db.prepare("SELECT * FROM poems WHERE id = ?")
      .get(result.lastInsertRowid)
  );
});
app.put("/api/poems/:id", requireAdmin, (req, res) => {
  const { title, author, content } = req.body;
  const id = Number(req.params.id);

  if (!title || !author || !content) {
    return res.status(400).json({ error: "Title, author and poem content are required." });
  }

  const result = db.prepare(
    "UPDATE poems SET title = ?, author = ?, content = ? WHERE id = ?"
  ).run(title.trim(), author.trim(), content.trim(), id);

  if (!result.changes) return res.status(404).json({ error: "Poem not found." });
  res.json(db.prepare("SELECT * FROM poems WHERE id = ?").get(id));
});

app.delete("/api/poems/:id", requireAdmin, (req, res) => {
  const result = db.prepare("DELETE FROM poems WHERE id = ?").run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: "Poem not found." });
  res.json({ ok: true });
});

// Admin painting management
app.post("/api/paintings", requireAdmin, upload.single("image"), (req, res) => {
  const { title, artist } = req.body;
  if (!title || !artist || !req.file) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Title, artist and an image are required." });
  }

  const image = `/uploads/${req.file.filename}`;
  const result = db.prepare(
    "INSERT INTO paintings (title, artist, image) VALUES (?, ?, ?)"
  ).run(title.trim(), artist.trim(), image);

  res.status(201).json(
    db.prepare("SELECT * FROM paintings WHERE id = ?").get(result.lastInsertRowid)
  );
});

app.delete("/api/paintings/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const painting = db.prepare("SELECT image FROM paintings WHERE id = ?").get(id);
  if (!painting) return res.status(404).json({ error: "Painting not found." });

  db.prepare("DELETE FROM paintings WHERE id = ?").run(id);

  const filename = path.basename(painting.image);
  const filePath = path.join(UPLOAD_DIR, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  res.json({ ok: true });
});

// Contact form
app.post("/api/contact", (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: "Please fill in all fields." });
  }

  db.prepare(
    "INSERT INTO messages (name, email, message) VALUES (?, ?, ?)"
  ).run(name.trim(), email.trim(), message.trim());

  res.status(201).json({ ok: true, message: "Your message has been sent." });
});

app.get("/api/messages", requireAdmin, (_req, res) => {
  res.json(db.prepare("SELECT * FROM messages ORDER BY id DESC").all());
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(ROOT, "public", "admin.html"));
});

app.listen(PORT, () => {
  console.log(`Palate and Prose is running at http://localhost:${PORT}`);
});
app.get("/admin", (_req, res) => {
  res.sendFile(path.join(ROOT, "public", "admin.html"));
});

app.listen(PORT, () => {
  console.log(`Palate and Prose is running at http://localhost:${PORT}`);
});