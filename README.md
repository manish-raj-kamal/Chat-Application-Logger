# 🚀 ChatApp Logger v2.0

> A real-time encrypted chat application with a **C++ backend**, **FIFO Queue** data structure visualization, **Google OAuth**, and a stunning **neumorphic + liquid glass** UI.

[![C++17](https://img.shields.io/badge/C++-17-blue?logo=cplusplus)](https://isocpp.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-green?logo=mongodb)](https://www.mongodb.com/atlas)
[![Render](https://img.shields.io/badge/Deploy-Render-purple?logo=render)](https://render.com)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔧 **C++ Backend** | HTTP server built with `cpp-httplib`, compiled C++17 |
| 📊 **Queue (FIFO)** | Template-based Queue data structure — the core DSA component |
| 🔐 **AES-256 Encryption** | Messages encrypted before storage, decrypted on retrieval |
| 🔑 **Google OAuth 2.0** | Secure login via Google Identity Services |
| 💬 **Global + Private Chat** | Public room and direct messages between users |
| 🎨 **Neumorphic UI** | Premium dark theme with liquid glass effects |
| 🌐 **Vanta.js Background** | Interactive 3D animated login screen |
| 📨 **Queue Visualization** | Live panel showing the last 10 messages in FIFO order |
| 📥 **Chat Download** | Export conversations as readable `.txt` files |
| 🐳 **Docker + Render** | One-click deployment with Dockerfile |

---

## 📂 Project Structure

```
ChatApp-Logger/
├── cpp/                         # C++ Backend
│   ├── server.cpp               #   HTTP server, routes, auth, encryption, DB
│   └── queue.hpp                #   FIFO Queue template (core DSA)
├── include/                     # Header-only libraries (downloaded at build)
│   ├── httplib.h                #   cpp-httplib — HTTP server
│   └── json.hpp                 #   nlohmann/json — JSON parsing
├── public/                      # Frontend
│   ├── index.html               #   Neumorphic chat UI
│   ├── style.css                #   Dark theme + liquid glass CSS
│   └── app.js                   #   Client logic, Google Sign-In, smooth refresh
├── Dockerfile                   # Docker build (for Render deployment)
├── render.yaml                  # Render service config
├── BUILD.bat                    # Local Windows build script
├── .env.example                 # Environment variable template
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites

- **g++** (C++17 support) — [MinGW-w64](https://www.mingw-w64.org/) on Windows
- **MongoDB Atlas** account (free tier) — [mongodb.com/atlas](https://www.mongodb.com/atlas)

### 1. Clone & Download Dependencies

```bash
git clone https://github.com/manish-raj-kamal/Chat-Application-Logger.git
cd Chat-Application-Logger

# Download header-only libraries
mkdir -p include
# Windows (PowerShell):
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/yhirose/cpp-httplib/v0.18.3/httplib.h" -OutFile "include\httplib.h"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/nlohmann/json/v3.11.3/single_include/nlohmann/json.hpp" -OutFile "include\json.hpp"

# Linux/macOS:
wget -O include/httplib.h "https://raw.githubusercontent.com/yhirose/cpp-httplib/v0.18.3/httplib.h"
wget -O include/json.hpp "https://raw.githubusercontent.com/nlohmann/json/v3.11.3/single_include/nlohmann/json.hpp"
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your values:

```env
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority
PORT=8080
ENCRYPTION_KEY=your_secret_encryption_key
GOOGLE_CLIENT_ID=your_google_oauth_client_id
JWT_SECRET=your_jwt_secret_key
```

### 3. Build & Run (Local — Simple Mode)

```bash
# Windows
BUILD.bat
server.exe

# Linux
g++ -std=c++17 -O2 -o server cpp/server.cpp -Iinclude -Icpp -lpthread
./server
```

Open **http://localhost:8080** → login with a username → start chatting!

> **Local mode** uses in-memory storage and simple username auth (no MongoDB or OpenSSL needed).

### 4. Build & Run (Full Mode — with MongoDB + Encryption)

```bash
g++ -std=c++17 -O2 \
    -DCPPHTTPLIB_OPENSSL_SUPPORT -DUSE_MONGODB \
    -o server cpp/server.cpp \
    -Iinclude -Icpp \
    $(pkg-config --cflags --libs libmongoc-1.0) \
    -lssl -lcrypto -lpthread
```

Requires: `libssl-dev`, `libmongoc-dev`, `libbson-dev`

---

## 🐳 Deploy to Render

1. Push code to GitHub
2. Go to [render.com](https://render.com) → **New** → **Web Service**
3. Connect your repo → select **Docker** runtime
4. Add environment variables: `MONGODB_URI`, `ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `JWT_SECRET`
5. Deploy!

The `Dockerfile` handles everything — installs dependencies, downloads libraries, compiles the C++ server.

### Google OAuth Setup

In [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials** → your OAuth Client:

**Authorized JavaScript Origins:**
```
http://localhost:8080
https://your-app.onrender.com
```

---

## 🔌 API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/config` | ❌ | Returns Google Client ID |
| `POST` | `/api/auth/google` | ❌ | Google OAuth token verification → JWT |
| `POST` | `/api/auth/simple` | ❌ | Simple username login → JWT (local mode) |
| `GET` | `/api/users` | ✅ | List all registered users |
| `GET` | `/api/messages` | ✅ | Fetch messages (`?chatType=global\|private&with=email&since=ts`) |
| `POST` | `/api/send` | ✅ | Send message (`{message, chatType, to}`) |
| `POST` | `/api/clear` | ✅ | Clear messages for a chat |
| `GET` | `/api/stats` | ✅ | Chat statistics |
| `GET` | `/api/download` | ✅ | Download chat as `.txt` file |

> ✅ = Requires `Authorization: Bearer <JWT>` header

---

## 🗃️ Queue Data Structure

The core DSA component (`cpp/queue.hpp`) implements a **template-based FIFO Queue**:

```cpp
template<typename T>
class Queue {
    std::deque<T> data_;
    size_t maxDisplaySize_;
public:
    void enqueue(const T& item);     // O(1) — add to back
    T dequeue();                      // O(1) — remove from front
    const T& peek() const;           // O(1) — view front
    std::vector<T> getAll() const;   // Full history
    std::vector<T> getDisplayQueue() const;  // Last 10 for visualization
};
```

- **All messages are kept** in the database permanently
- The **Queue visualization panel** shows only the **last 10 messages** in FIFO order
- Supports `enqueue`, `dequeue`, `peek`, `size`, `clear`, and iterator access

---

## 🔒 Security

| Layer | Implementation |
|-------|----------------|
| **Authentication** | Google OAuth 2.0 (ID token verified via Google's `tokeninfo` endpoint) |
| **Session** | JWT (HS256) with 7-day expiry |
| **Encryption** | AES-256-CBC (CryptoJS-compatible format, OpenSSL) |
| **CORS** | Configured with `Cross-Origin-Opener-Policy: same-origin-allow-popups` |
| **AI Protection** | `.env` excluded from AI tools via `.cursorignore` and `.gemini/settings.json` |

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| **Backend** | C++17, cpp-httplib, OpenSSL, libmongoc |
| **Frontend** | HTML5, CSS3 (Neumorphic), JavaScript (ES6+) |
| **Database** | MongoDB Atlas (ChatLogger DB → Users & Chats collections) |
| **Auth** | Google Identity Services, JWT |
| **Deployment** | Docker, Render |
| **Libraries** | nlohmann/json, cpp-httplib, Vanta.js, Font Awesome |

---

## 🎓 Educational Value

This project demonstrates:

- **Queue (FIFO)** data structure with real-world application
- **C++ HTTP server** development using modern C++17
- **AES-256 encryption** with OpenSSL (CryptoJS-compatible)
- **JWT authentication** implemented from scratch in C++
- **Google OAuth 2.0** integration in a C++ backend
- **MongoDB** operations via the C driver from C++
- **Docker** containerization for cloud deployment
- **Modern web frontend** with neumorphic design

---

## 📄 License

MIT — feel free to use, modify, and distribute.

## 🤝 Contributing

Fixes and improvements welcome! Open an issue or submit a PR.
