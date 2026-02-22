# ChatApp Logger v2.0

A beautiful real-time chat application demonstrating **Queue (FIFO)** data structure with **MongoDB Atlas** persistence, a modern premium UI, and Vercel deployment support.

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js** 18 or later
- **MongoDB Atlas** account (free tier works)

### 2. Setup
```bash
git clone https://github.com/<your-username>/ChatApp-Logger.git
cd ChatApp-Logger
npm install
```

### 3. Configure MongoDB
Add your MongoDB Atlas connection string to `.env`:
```
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/chatapp?retryWrites=true&w=majority
PORT=8080
```

### 4. Run
```bash
npm run dev
```
Open **http://localhost:8080** in your browser.

---

## 🌐 Deploy to Vercel

1. Push your code to GitHub
2. Import the repository on [Vercel](https://vercel.com)
3. Add `MONGODB_URI` as an environment variable in the Vercel dashboard
4. Deploy!

The project includes `vercel.json` for proper serverless routing.

---

## 📂 Project Structure

```
ChatApp-Logger/
├── api/
│   ├── server.js              # Express server + API routes
│   └── models/
│       └── Message.js         # Mongoose schema
├── public/
│   ├── index.html             # Chat UI
│   ├── style.css              # Premium dark theme
│   └── app.js                 # Frontend logic
├── src/                       # Legacy C++ source (reference)
│   ├── main.cpp
│   ├── chat_logger.cpp
│   ├── chat_logger.h
│   ├── http_server.cpp
│   └── http_server.h
├── web/                       # Legacy HTML UI (reference)
├── .env                       # Environment variables (not tracked)
├── .env.example               # Environment template
├── .gitignore
├── vercel.json                # Vercel deployment config
├── package.json
└── README.md
```

---

## 🔌 API Endpoints

| Method | Endpoint          | Description                                        |
|--------|-------------------|----------------------------------------------------|
| GET    | `/api/messages`   | Get all messages grouped by user                   |
| POST   | `/api/send`       | Send message: `{"username":"Alice","message":"Hi"}`|
| POST   | `/api/clear`      | Clear all stored messages                          |
| GET    | `/api/stats`      | Get chat statistics                                |

---

## 🗃️ Key Features

- **Real-time Chat UI** — Beautiful dark-themed interface with message bubbles
- **Two-user Chat** — Login as different users to simulate real conversations
- **MongoDB Atlas** — Cloud database for persistent message storage
- **Queue Visualization** — See the FIFO data structure in action
- **Emoji Support** — Built-in emoji picker
- **Export Chat** — Download conversation as JSON
- **Responsive Design** — Works on desktop and mobile
- **Vercel Ready** — Deploy with one click

---

## 🎓 Educational Use

Demonstrates:
- Queue (FIFO) data structure in action
- RESTful API design with Express.js
- MongoDB/Mongoose data modeling
- Modern frontend development
- Serverless deployment with Vercel

---

## 🤝 Contributing

Fixes and improvements welcome! Open an issue or submit a PR.
