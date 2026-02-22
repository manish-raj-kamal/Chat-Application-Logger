// ═══════════════════════════════════════════════════════════
//  ChatApp Logger — C++ Backend Server
//  HTTP Server · Google OAuth · AES-256 · MongoDB · Queue
// ═══════════════════════════════════════════════════════════

#ifdef USE_MONGODB
#include <mongoc/mongoc.h>
#endif

#ifdef CPPHTTPLIB_OPENSSL_SUPPORT
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/rand.h>
#include <openssl/bio.h>
#include <openssl/buffer.h>
#endif

#include "httplib.h"
#include "json.hpp"
#include "queue.hpp"

#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <map>
#include <mutex>
#include <ctime>
#include <cstring>
#include <algorithm>
#include <functional>
#include <chrono>

using json = nlohmann::json;
using namespace httplib;

// ── Configuration ─────────────────────────────────────────
struct Config {
    std::string mongodb_uri;
    std::string encryption_key;
    std::string google_client_id;
    std::string jwt_secret;
    int port = 8080;
};

static Config config;

// ── .env loader ───────────────────────────────────────────
void loadEnvFile(const std::string& path = ".env") {
    std::ifstream file(path);
    if (!file.is_open()) return;
    std::string line;
    while (std::getline(file, line)) {
        if (line.empty() || line[0] == '#') continue;
        // Remove \r
        if (!line.empty() && line.back() == '\r') line.pop_back();
        auto eq = line.find('=');
        if (eq == std::string::npos) continue;
        std::string key = line.substr(0, eq);
        std::string val = line.substr(eq + 1);
        if (val.size() >= 2 && val.front() == '"' && val.back() == '"')
            val = val.substr(1, val.size() - 2);
#ifdef _WIN32
        _putenv_s(key.c_str(), val.c_str());
#else
        setenv(key.c_str(), val.c_str(), 1);
#endif
    }
}

void loadConfig() {
    auto env = [](const char* key, const char* def = "") -> std::string {
        const char* v = std::getenv(key);
        return v ? v : def;
    };
    config.mongodb_uri = env("MONGODB_URI");
    config.encryption_key = env("ENCRYPTION_KEY", "default-key-change-me");
    config.google_client_id = env("GOOGLE_CLIENT_ID");
    config.jwt_secret = env("JWT_SECRET", "default-jwt-secret");
    config.port = std::stoi(env("PORT", "8080"));
}

// ── Data Structures ───────────────────────────────────────
struct Message {
    std::string id;
    std::string from;
    std::string fromName;
    std::string fromAvatar;
    std::string to;
    std::string toName;
    std::string content;        // encrypted in DB, plain in memory
    std::string chatType;       // "global" or "private"
    int64_t timestamp;

    json toJson() const {
        return {
            {"_id", id}, {"from", from}, {"fromName", fromName},
            {"fromAvatar", fromAvatar}, {"to", to}, {"toName", toName},
            {"content", content}, {"chatType", chatType}, {"timestamp", timestamp}
        };
    }
};

struct User {
    std::string googleId;
    std::string email;
    std::string name;
    std::string avatar;
    int64_t lastActive;
};

// ── In-Memory Storage + Queue ─────────────────────────────
static std::mutex dataMutex;
static std::map<std::string, User> users;           // email -> User
static Queue<Message> globalQueue(10);               // Queue visualization
static std::vector<Message> allMessages;             // Full history
static int messageCounter = 0;

int64_t nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()
    ).count();
}

std::string genId() {
    return std::to_string(nowMs()) + "_" + std::to_string(++messageCounter);
}

// ═══════════════════════════════════════════════════════════
//  MongoDB Operations (when USE_MONGODB is defined)
// ═══════════════════════════════════════════════════════════

#ifdef USE_MONGODB
static mongoc_client_t* mongoClient = nullptr;
static bool mongoConnected = false;

bool mongoConnect() {
    mongoc_init();
    mongoClient = mongoc_client_new(config.mongodb_uri.c_str());
    if (!mongoClient) return false;
    mongoc_client_set_appname(mongoClient, "ChatAppLogger-CPP");

    bson_t* cmd = BCON_NEW("ping", BCON_INT32(1));
    bson_t reply;
    bson_error_t err;
    bool ok = mongoc_client_command_simple(mongoClient, "admin", cmd, NULL, &reply, &err);
    bson_destroy(cmd);
    bson_destroy(&reply);
    if (!ok) {
        std::cerr << "MongoDB error: " << err.message << std::endl;
        return false;
    }

    // Drop legacy username index if exists
    mongoc_collection_t* col = mongoc_client_get_collection(mongoClient, "ChatLogger", "Users");
    mongoc_collection_drop_index(col, "username_1", NULL);
    mongoc_collection_destroy(col);

    mongoConnected = true;
    return true;
}

json mongoBsonToJson(const bson_t* doc) {
    char* str = bson_as_canonical_extended_json(doc, NULL);
    json j = json::parse(str, nullptr, false);
    bson_free(str);
    return j;
}

// Safely extract timestamp (ms) from various MongoDB date formats
int64_t extractTimestamp(const json& d) {
    try {
        if (!d.contains("timestamp")) return nowMs();
        auto& ts = d["timestamp"];
        // Canonical: {"$date": {"$numberLong": "123456"}}
        if (ts.contains("$date")) {
            auto& dt = ts["$date"];
            if (dt.is_object() && dt.contains("$numberLong"))
                return std::stoll(dt["$numberLong"].get<std::string>());
            if (dt.is_string()) return nowMs(); // ISO string, skip parsing
            if (dt.is_number()) return dt.get<int64_t>();
        }
        if (ts.is_number()) return ts.get<int64_t>();
    } catch (...) {}
    return nowMs();
}

// Safely extract string _id from BSON ObjectId or string
std::string extractId(const json& d) {
    try {
        if (!d.contains("_id")) return genId();
        auto& id = d["_id"];
        if (id.is_string()) return id.get<std::string>();
        if (id.is_object() && id.contains("$oid")) return id["$oid"].get<std::string>();
        return id.dump();
    } catch (...) {}
    return genId();
}

bson_t* mongoJsonToBson(const std::string& jsonStr) {
    bson_error_t err;
    bson_t* doc = bson_new_from_json((const uint8_t*)jsonStr.c_str(), jsonStr.size(), &err);
    return doc ? doc : bson_new();
}

json mongoUpsertUser(const User& user) {
    if (!mongoConnected) return {};
    mongoc_collection_t* col = mongoc_client_get_collection(mongoClient, "ChatLogger", "Users");

    std::string filter = json({{"googleId", user.googleId}}).dump();
    std::string update = json({{"$set", {
        {"googleId", user.googleId}, {"email", user.email},
        {"name", user.name}, {"avatar", user.avatar},
        {"lastActive", {{"$date", {{"$numberLong", std::to_string(user.lastActive)}}}}}
    }}, {"$setOnInsert", {
        {"createdAt", {{"$date", {{"$numberLong", std::to_string(nowMs())}}}}}
    }}}).dump();

    bson_t* bFilter = mongoJsonToBson(filter);
    bson_t* bUpdate = mongoJsonToBson(update);
    bson_t opts;
    bson_init(&opts);
    BSON_APPEND_BOOL(&opts, "upsert", true);

    bson_error_t err;
    mongoc_collection_update_one(col, bFilter, bUpdate, &opts, NULL, &err);

    bson_destroy(bFilter);
    bson_destroy(bUpdate);
    bson_destroy(&opts);
    mongoc_collection_destroy(col);
    return {};
}

void mongoInsertChat(const Message& msg, const std::string& encryptedContent) {
    if (!mongoConnected) return;
    mongoc_collection_t* col = mongoc_client_get_collection(mongoClient, "ChatLogger", "Chats");

    json doc = {
        {"from", msg.from}, {"fromName", msg.fromName}, {"fromAvatar", msg.fromAvatar},
        {"to", msg.to}, {"toName", msg.toName}, {"content", encryptedContent},
        {"chatType", msg.chatType},
        {"timestamp", {{"$date", {{"$numberLong", std::to_string(msg.timestamp)}}}}}
    };

    bson_t* bDoc = mongoJsonToBson(doc.dump());
    bson_error_t err;
    mongoc_collection_insert_one(col, bDoc, NULL, NULL, &err);
    bson_destroy(bDoc);
    mongoc_collection_destroy(col);
}

std::vector<json> mongoFindChats(const json& query) {
    if (!mongoConnected) return {};
    mongoc_collection_t* col = mongoc_client_get_collection(mongoClient, "ChatLogger", "Chats");

    bson_t* bQuery = mongoJsonToBson(query.dump());
    bson_t* bOpts = mongoJsonToBson(R"({"sort": {"timestamp": 1}})");

    mongoc_cursor_t* cursor = mongoc_collection_find_with_opts(col, bQuery, bOpts, NULL);
    const bson_t* doc;
    std::vector<json> results;
    while (mongoc_cursor_next(cursor, &doc)) {
        results.push_back(mongoBsonToJson(doc));
    }

    mongoc_cursor_destroy(cursor);
    bson_destroy(bQuery);
    bson_destroy(bOpts);
    mongoc_collection_destroy(col);
    return results;
}

void mongoDeleteChats(const json& query) {
    if (!mongoConnected) return;
    mongoc_collection_t* col = mongoc_client_get_collection(mongoClient, "ChatLogger", "Chats");
    bson_t* bQuery = mongoJsonToBson(query.dump());
    bson_error_t err;
    mongoc_collection_delete_many(col, bQuery, NULL, NULL, &err);
    bson_destroy(bQuery);
    mongoc_collection_destroy(col);
}

std::vector<json> mongoFindUsers() {
    if (!mongoConnected) return {};
    mongoc_collection_t* col = mongoc_client_get_collection(mongoClient, "ChatLogger", "Users");
    bson_t* bQuery = bson_new();
    mongoc_cursor_t* cursor = mongoc_collection_find_with_opts(col, bQuery, NULL, NULL);
    const bson_t* doc;
    std::vector<json> results;
    while (mongoc_cursor_next(cursor, &doc)) {
        results.push_back(mongoBsonToJson(doc));
    }
    mongoc_cursor_destroy(cursor);
    bson_destroy(bQuery);
    mongoc_collection_destroy(col);
    return results;
}
#endif // USE_MONGODB

// ═══════════════════════════════════════════════════════════
//  Base64 Encoding / Decoding
// ═══════════════════════════════════════════════════════════

static const std::string B64_CHARS =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string base64_encode(const std::string& in) {
    std::string out;
    int val = 0, valb = -6;
    for (unsigned char c : in) {
        val = (val << 8) + c;
        valb += 8;
        while (valb >= 0) {
            out.push_back(B64_CHARS[(val >> valb) & 0x3F]);
            valb -= 6;
        }
    }
    if (valb > -6) out.push_back(B64_CHARS[((val << 8) >> (valb + 8)) & 0x3F]);
    while (out.size() % 4) out.push_back('=');
    return out;
}

std::string base64_decode(const std::string& in) {
    std::vector<int> T(256, -1);
    for (int i = 0; i < 64; i++) T[B64_CHARS[i]] = i;
    std::string out;
    int val = 0, valb = -8;
    for (unsigned char c : in) {
        if (T[c] == -1) break;
        val = (val << 6) + T[c];
        valb += 6;
        if (valb >= 0) {
            out.push_back(char((val >> valb) & 0xFF));
            valb -= 8;
        }
    }
    return out;
}

std::string base64url_encode(const std::string& data) {
    std::string b = base64_encode(data);
    for (auto& c : b) { if (c == '+') c = '-'; else if (c == '/') c = '_'; }
    b.erase(std::remove(b.begin(), b.end(), '='), b.end());
    return b;
}

std::string base64url_decode(const std::string& data) {
    std::string b = data;
    for (auto& c : b) { if (c == '-') c = '+'; else if (c == '_') c = '/'; }
    while (b.size() % 4) b += '=';
    return base64_decode(b);
}

// ═══════════════════════════════════════════════════════════
//  AES-256 Encryption (OpenSSL, CryptoJS compatible)
// ═══════════════════════════════════════════════════════════

#ifdef CPPHTTPLIB_OPENSSL_SUPPORT
std::string aes_encrypt(const std::string& plaintext, const std::string& passphrase) {
    unsigned char salt[8];
    RAND_bytes(salt, 8);

    unsigned char key[32], iv[16];
    EVP_BytesToKey(EVP_aes_256_cbc(), EVP_md5(), salt,
                   (const unsigned char*)passphrase.c_str(), passphrase.size(), 1, key, iv);

    EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
    EVP_EncryptInit_ex(ctx, EVP_aes_256_cbc(), NULL, key, iv);

    std::vector<unsigned char> ct(plaintext.size() + 32);
    int len = 0, total = 0;
    EVP_EncryptUpdate(ctx, ct.data(), &len, (const unsigned char*)plaintext.c_str(), plaintext.size());
    total = len;
    EVP_EncryptFinal_ex(ctx, ct.data() + len, &len);
    total += len;
    EVP_CIPHER_CTX_free(ctx);

    std::string raw = "Salted__";
    raw.append((char*)salt, 8);
    raw.append((char*)ct.data(), total);
    return base64_encode(raw);
}

std::string aes_decrypt(const std::string& encoded, const std::string& passphrase) {
    try {
        std::string raw = base64_decode(encoded);
        if (raw.size() < 16 || raw.substr(0, 8) != "Salted__") return "[decryption failed]";

        unsigned char salt[8];
        memcpy(salt, raw.c_str() + 8, 8);

        unsigned char key[32], iv[16];
        EVP_BytesToKey(EVP_aes_256_cbc(), EVP_md5(), salt,
                       (const unsigned char*)passphrase.c_str(), passphrase.size(), 1, key, iv);

        std::string ct = raw.substr(16);
        EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
        EVP_DecryptInit_ex(ctx, EVP_aes_256_cbc(), NULL, key, iv);

        std::vector<unsigned char> pt(ct.size() + 32);
        int len = 0, total = 0;
        EVP_DecryptUpdate(ctx, pt.data(), &len, (const unsigned char*)ct.c_str(), ct.size());
        total = len;
        EVP_DecryptFinal_ex(ctx, pt.data() + len, &len);
        total += len;
        EVP_CIPHER_CTX_free(ctx);
        return std::string((char*)pt.data(), total);
    } catch (...) {
        return "[decryption failed]";
    }
}
#else
// Fallback: no encryption
std::string aes_encrypt(const std::string& plaintext, const std::string&) { return base64_encode(plaintext); }
std::string aes_decrypt(const std::string& encoded, const std::string&) { return base64_decode(encoded); }
#endif

// ═══════════════════════════════════════════════════════════
//  JWT (HS256) — Create & Verify
// ═══════════════════════════════════════════════════════════

std::string jwt_sign(const std::string& input, const std::string& secret) {
#ifdef CPPHTTPLIB_OPENSSL_SUPPORT
    unsigned char hmac[EVP_MAX_MD_SIZE];
    unsigned int hmacLen;
    HMAC(EVP_sha256(), secret.c_str(), secret.size(),
         (unsigned char*)input.c_str(), input.size(), hmac, &hmacLen);
    return base64url_encode(std::string((char*)hmac, hmacLen));
#else
    // Simple hash fallback (NOT secure, for local dev only)
    size_t h = std::hash<std::string>{}(input + secret);
    return base64url_encode(std::to_string(h));
#endif
}

std::string create_jwt(const json& payload, const std::string& secret) {
    json header = {{"alg", "HS256"}, {"typ", "JWT"}};
    std::string h = base64url_encode(header.dump());
    std::string p = base64url_encode(payload.dump());
    std::string sig = jwt_sign(h + "." + p, secret);
    return h + "." + p + "." + sig;
}

json verify_jwt(const std::string& token, const std::string& secret) {
    auto d1 = token.find('.');
    auto d2 = token.find('.', d1 + 1);
    if (d1 == std::string::npos || d2 == std::string::npos) return nullptr;

    std::string sigInput = token.substr(0, d2);
    std::string sig = token.substr(d2 + 1);
    if (jwt_sign(sigInput, secret) != sig) return nullptr;

    std::string payloadStr = base64url_decode(token.substr(d1 + 1, d2 - d1 - 1));
    json payload = json::parse(payloadStr, nullptr, false);
    if (payload.is_discarded()) return nullptr;

    if (payload.contains("exp") && payload["exp"].get<int64_t>() < std::time(nullptr))
        return nullptr;

    return payload;
}

// ── Auth Middleware ────────────────────────────────────────
json extractUser(const Request& req) {
    try {
        std::string auth = req.get_header_value("Authorization");
        if (auth.size() < 8 || auth.substr(0, 7) != "Bearer ") return nullptr;
        return verify_jwt(auth.substr(7), config.jwt_secret);
    } catch (...) {
        return nullptr;
    }
}

// ═══════════════════════════════════════════════════════════
//  Google OAuth Token Verification
// ═══════════════════════════════════════════════════════════

json verifyGoogleToken(const std::string& idToken) {
#ifdef CPPHTTPLIB_OPENSSL_SUPPORT
    httplib::SSLClient cli("oauth2.googleapis.com");
    cli.set_connection_timeout(5);
    auto res = cli.Get(("/tokeninfo?id_token=" + idToken).c_str());
    if (res && res->status == 200) {
        json data = json::parse(res->body, nullptr, false);
        if (!data.is_discarded() && data.contains("email")) {
            return data;
        }
    }
#endif
    return nullptr;
}

// ═══════════════════════════════════════════════════════════
//  MAIN — HTTP Server & Routes
// ═══════════════════════════════════════════════════════════

int main() {
    // Disable stdout/stderr buffering for Docker (Render needs to see logs)
    std::cout << std::unitbuf;
    std::cerr << std::unitbuf;
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);

    std::cout << "Starting ChatApp Logger C++ server..." << std::endl;

    loadEnvFile();
    loadConfig();

    std::cout << "Config loaded. Port=" << config.port
              << " MongoDB=" << (!config.mongodb_uri.empty() ? "configured" : "not set")
              << " Google=" << (!config.google_client_id.empty() ? "configured" : "not set")
              << std::endl;

    Server svr;

    // ── CORS & Headers (post-routing) ─────────────────────
    svr.set_post_routing_handler([](const Request&, Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_header("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
        res.set_header("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    });

    // ── Preflight ─────────────────────────────────────────
    svr.Options(R"(/.*)", [](const Request&, Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_header("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
        res.status = 204;
    });

    // ── Serve static files from public/ ───────────────────
    svr.set_mount_point("/", "./public");

    // ═══════ API ROUTES ═══════════════════════════════════

    // Health check for Render
    svr.Get("/healthz", [](const Request&, Response& res) {
        res.set_content(R"({"status":"ok"})", "application/json");
    });

    // GET /api/config
    svr.Get("/api/config", [](const Request&, Response& res) {
        res.set_content(json({{"googleClientId", config.google_client_id}}).dump(), "application/json");
    });

    // POST /api/auth/google — Verify Google token
    svr.Post("/api/auth/google", [](const Request& req, Response& res) {
        auto body = json::parse(req.body, nullptr, false);
        if (body.is_discarded() || !body.contains("credential")) {
            res.status = 400;
            res.set_content(R"({"error":"Missing credential"})", "application/json");
            return;
        }

        json gUser = verifyGoogleToken(body["credential"]);
        if (gUser.is_null()) {
            res.status = 401;
            res.set_content(R"({"error":"Google token verification failed"})", "application/json");
            return;
        }

        std::string email = gUser["email"];
        std::string name = gUser.value("name", email);
        std::string avatar = gUser.value("picture", "");
        std::string sub = gUser.value("sub", "");

        User user{sub, email, name, avatar, nowMs()};
        {
            std::lock_guard<std::mutex> lock(dataMutex);
            users[email] = user;
        }

#ifdef USE_MONGODB
        mongoUpsertUser(user);
#endif

        json payload = {
            {"email", email}, {"name", name}, {"avatar", avatar},
            {"exp", std::time(nullptr) + 7 * 24 * 3600}
        };
        std::string token = create_jwt(payload, config.jwt_secret);

        res.set_content(json({
            {"success", true}, {"token", token},
            {"user", {{"email", email}, {"name", name}, {"avatar", avatar}}}
        }).dump(), "application/json");
    });

    // POST /api/auth/simple — Fallback (no Google, local dev)
    svr.Post("/api/auth/simple", [](const Request& req, Response& res) {
        auto body = json::parse(req.body, nullptr, false);
        if (body.is_discarded() || !body.contains("username")) {
            res.status = 400;
            res.set_content(R"({"error":"Missing username"})", "application/json");
            return;
        }
        std::string username = body["username"];
        std::string email = username + "@local";

        User user{"local_" + username, email, username, "", nowMs()};
        {
            std::lock_guard<std::mutex> lock(dataMutex);
            users[email] = user;
        }
#ifdef USE_MONGODB
        mongoUpsertUser(user);
#endif

        json payload = {
            {"email", email}, {"name", username}, {"avatar", ""},
            {"exp", std::time(nullptr) + 7 * 24 * 3600}
        };
        std::string token = create_jwt(payload, config.jwt_secret);

        res.set_content(json({
            {"success", true}, {"token", token},
            {"user", {{"email", email}, {"name", username}, {"avatar", ""}}}
        }).dump(), "application/json");
    });

    // GET /api/users
    svr.Get("/api/users", [](const Request& req, Response& res) {
      try {
        json user = extractUser(req);
        if (user.is_null()) { res.status = 401; res.set_content(R"({"error":"Unauthorized"})", "application/json"); return; }

        json userList = json::array();
#ifdef USE_MONGODB
        auto dbUsers = mongoFindUsers();
        for (auto& u : dbUsers) {
            userList.push_back({
                {"email", u.value("email", "")}, {"name", u.value("name", "")},
                {"avatar", u.value("avatar", "")}
            });
        }
#else
        std::lock_guard<std::mutex> lock(dataMutex);
        for (auto& [email, u] : users) {
            userList.push_back({{"email", u.email}, {"name", u.name}, {"avatar", u.avatar}});
        }
#endif
        res.set_content(json({{"users", userList}}).dump(), "application/json");
      } catch (const std::exception& e) {
        std::cerr << "GET /api/users error: " << e.what() << std::endl;
        res.status = 500;
        res.set_content(json({{"error", e.what()}}).dump(), "application/json");
      }
    });

    // GET /api/messages
    svr.Get("/api/messages", [](const Request& req, Response& res) {
      try {
        json user = extractUser(req);
        if (user.is_null()) { res.status = 401; res.set_content(R"({"error":"Unauthorized"})", "application/json"); return; }

        std::string chatType = req.get_param_value("chatType");
        if (chatType.empty()) chatType = "global";
        std::string withUser = req.get_param_value("with");
        std::string since = req.get_param_value("since");
        std::string email = user["email"];
        int64_t sinceTs = 0;
        try { if (!since.empty()) sinceTs = std::stoll(since); } catch (...) {}

        json messages = json::array();

#ifdef USE_MONGODB
        json query;
        if (chatType == "global") {
            query = {{"chatType", "global"}};
        } else if (chatType == "private" && !withUser.empty()) {
            query = {{"chatType", "private"}, {"$or", {{{{"from", email}, {"to", withUser}}, {{"from", withUser}, {"to", email}}}}}};
        }
        // Note: timestamp filtering with $gt and $date is complex in extended JSON.
        // We filter client-side for simplicity and reliability.
        auto docs = mongoFindChats(query);
        for (auto& d : docs) {
            try {
                int64_t ts = extractTimestamp(d);
                if (sinceTs > 0 && ts <= sinceTs) continue;
                std::string content = d.value("content", "");
                messages.push_back({
                    {"_id", extractId(d)},
                    {"from", d.value("from", "")}, {"fromName", d.value("fromName", "")},
                    {"fromAvatar", d.value("fromAvatar", "")}, {"to", d.value("to", "")},
                    {"toName", d.value("toName", "")},
                    {"content", aes_decrypt(content, config.encryption_key)},
                    {"chatType", d.value("chatType", "global")},
                    {"timestamp", ts}
                });
            } catch (const std::exception& e) {
                std::cerr << "Skipping bad message doc: " << e.what() << std::endl;
            }
        }
#else
        std::lock_guard<std::mutex> lock(dataMutex);
        for (auto& msg : allMessages) {
            if (msg.timestamp <= sinceTs) continue;
            bool match = false;
            if (chatType == "global" && msg.chatType == "global") match = true;
            if (chatType == "private" && !withUser.empty()) {
                if ((msg.from == email && msg.to == withUser) || (msg.from == withUser && msg.to == email))
                    match = true;
            }
            if (match) messages.push_back(msg.toJson());
        }
#endif
        res.set_content(json({{"messages", messages}}).dump(), "application/json");
      } catch (const std::exception& e) {
        std::cerr << "GET /api/messages error: " << e.what() << std::endl;
        res.status = 500;
        res.set_content(json({{"error", e.what()}}).dump(), "application/json");
      }
    });

    // POST /api/send
    svr.Post("/api/send", [](const Request& req, Response& res) {
        json user = extractUser(req);
        if (user.is_null()) { res.status = 401; res.set_content(R"({"error":"Unauthorized"})", "application/json"); return; }

        auto body = json::parse(req.body, nullptr, false);
        std::string messageText = body.value("message", "");
        std::string chatType = body.value("chatType", "global");
        std::string to = body.value("to", "global");
        if (messageText.empty()) { res.status = 400; res.set_content(R"({"error":"Empty message"})", "application/json"); return; }

        std::string email = user["email"];
        std::string name = user["name"];
        std::string avatar = user.value("avatar", "");

        if (chatType == "global") to = "global";
        std::string toName;
        {
            std::lock_guard<std::mutex> lock(dataMutex);
            if (chatType == "private" && users.count(to)) toName = users[to].name;
        }

        Message msg{genId(), email, name, avatar, to, toName, messageText, chatType, nowMs()};

        {
            std::lock_guard<std::mutex> lock(dataMutex);
            allMessages.push_back(msg);
            globalQueue.enqueue(msg);
        }

#ifdef USE_MONGODB
        mongoInsertChat(msg, aes_encrypt(messageText, config.encryption_key));
#endif

        res.set_content(json({
            {"success", true}, {"message", msg.toJson()}
        }).dump(), "application/json");
    });

    // POST /api/clear
    svr.Post("/api/clear", [](const Request& req, Response& res) {
        json user = extractUser(req);
        if (user.is_null()) { res.status = 401; res.set_content(R"({"error":"Unauthorized"})", "application/json"); return; }

        auto body = json::parse(req.body, nullptr, false);
        std::string chatType = body.value("chatType", "global");
        std::string withUser = body.value("with", "");
        std::string email = user["email"];

        {
            std::lock_guard<std::mutex> lock(dataMutex);
            allMessages.erase(std::remove_if(allMessages.begin(), allMessages.end(),
                [&](const Message& m) {
                    if (chatType == "global") return m.chatType == "global";
                    return m.chatType == "private" &&
                           ((m.from == email && m.to == withUser) || (m.from == withUser && m.to == email));
                }), allMessages.end());
            globalQueue.clear();
        }

#ifdef USE_MONGODB
        json query;
        if (chatType == "global") query = {{"chatType", "global"}};
        else query = {{"chatType", "private"}, {"$or", {{{"from", email}, {"to", withUser}}, {{"from", withUser}, {"to", email}}}}};
        mongoDeleteChats(query);
#endif
        res.set_content(R"({"success":true})", "application/json");
    });

    // GET /api/stats
    svr.Get("/api/stats", [](const Request& req, Response& res) {
        json user = extractUser(req);
        if (user.is_null()) { res.status = 401; res.set_content(R"({"error":"Unauthorized"})", "application/json"); return; }

        std::lock_guard<std::mutex> lock(dataMutex);
        res.set_content(json({
            {"totalMessages", allMessages.size()},
            {"totalUsers", users.size()},
            {"maxQueueSize", 10}
        }).dump(), "application/json");
    });

    // GET /api/download
    svr.Get("/api/download", [](const Request& req, Response& res) {
        json user = extractUser(req);
        if (user.is_null()) { res.status = 401; res.set_content(R"({"error":"Unauthorized"})", "application/json"); return; }

        std::string chatType = req.get_param_value("chatType");
        if (chatType.empty()) chatType = "global";
        std::string withUser = req.get_param_value("with");
        std::string email = user["email"];

        std::ostringstream out;
        out << std::string(50, '=') << "\n";
        out << "  ChatApp Logger — " << (chatType == "global" ? "Global Chat" : "DM with " + withUser) << "\n";
        out << "  Encryption: AES-256 (decrypted for download)\n";
        out << std::string(50, '=') << "\n\n";

        std::lock_guard<std::mutex> lock(dataMutex);
        for (auto& msg : allMessages) {
            bool match = false;
            if (chatType == "global" && msg.chatType == "global") match = true;
            if (chatType == "private" &&
                ((msg.from == email && msg.to == withUser) || (msg.from == withUser && msg.to == email)))
                match = true;
            if (match) {
                time_t t = msg.timestamp / 1000;
                char buf[64];
                strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", localtime(&t));
                out << "[" << buf << "] " << msg.fromName << ":\n  " << msg.content << "\n\n";
            }
        }
        out << std::string(50, '=') << "\n  End of Chat Log\n" << std::string(50, '=') << "\n";

        res.set_header("Content-Disposition", "attachment; filename=\"chat_log.txt\"");
        res.set_content(out.str(), "text/plain");
    });

    // ── Fallback: serve index.html ONLY for non-API 404s ──
    svr.set_error_handler([](const Request& req, Response& res) {
        // Don't serve HTML for API routes — return JSON errors
        std::string path = req.path;
        if (path.substr(0, 4) == "/api") {
            if (res.status == 404) {
                res.set_content(R"({"error":"Not found"})", "application/json");
            }
            return;
        }
        if (res.status == 404) {
            std::ifstream f("./public/index.html");
            if (f.is_open()) {
                std::string html((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
                res.set_content(html, "text/html");
                res.status = 200;
            }
        }
    });

    // ── Connect to MongoDB ────────────────────────────────
#ifdef USE_MONGODB
    if (!config.mongodb_uri.empty()) {
        try {
            if (mongoConnect()) {
                std::cout << "✅ Connected to MongoDB Atlas (ChatLogger)" << std::endl;
            } else {
                std::cerr << "❌ MongoDB connection failed — running without DB" << std::endl;
            }
        } catch (const std::exception& e) {
            std::cerr << "❌ MongoDB exception: " << e.what() << " — running without DB" << std::endl;
        } catch (...) {
            std::cerr << "❌ MongoDB unknown error — running without DB" << std::endl;
        }
    } else {
        std::cout << "⚠️  MONGODB_URI not set — running in-memory mode" << std::endl;
    }
#endif

    // ── Start Server ──────────────────────────────────────
    std::cout << "\n🚀 ChatApp Logger v2.0 (C++ Backend)" << std::endl;
    std::cout << "🌐 http://localhost:" << config.port << std::endl;
#ifdef USE_MONGODB
    std::cout << "📦 Database: MongoDB Atlas" << std::endl;
#else
    std::cout << "📦 Storage: In-Memory" << std::endl;
#endif
#ifdef CPPHTTPLIB_OPENSSL_SUPPORT
    std::cout << "🔒 Encryption: AES-256" << std::endl;
    std::cout << "🔑 Auth: Google OAuth 2.0" << std::endl;
#else
    std::cout << "🔑 Auth: Simple (local mode)" << std::endl;
#endif
    std::cout << "📨 Queue: 10 msgs visualization" << std::endl;
    std::cout << "⚡ Press Ctrl+C to stop\n" << std::endl;
    std::cout << std::flush;

    if (!svr.listen("0.0.0.0", config.port)) {
        std::cerr << "❌ Failed to bind to 0.0.0.0:" << config.port << std::endl;
        return 1;
    }

#ifdef USE_MONGODB
    if (mongoClient) {
        mongoc_client_destroy(mongoClient);
        mongoc_cleanup();
    }
#endif
    return 0;
}
