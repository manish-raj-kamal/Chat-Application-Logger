#include "chat_logger.h"
#include "http_server.h"
#include <iostream>
#include <sstream>
#include <fstream>
#include <signal.h>
#include <thread>
#include <chrono>

using namespace std;

// Signal handling and shutdown
ChatLogger* g_logger = nullptr;
HttpServer* g_server = nullptr;

void signalHandler(int signal) {
    cout << "\nShutting down..." << endl;
    
    if (g_logger) {
        cout << "Writing all messages to files..." << endl;
        g_logger->writeAllToFiles();
        g_logger->saveToJson();
    }
    
    if (g_server) {
        cout << "Stopping HTTP server..." << endl;
        g_server->stop();
    }
    
    exit(0);
}

string loadChatAppLoggerUI() {
    ifstream file("web/chat_app_logger.html");
    if (file.is_open()) {
        stringstream buffer;
        buffer << file.rdbuf();
        return buffer.str();
    }
    
    // Simple fallback
    return R"(<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Chat App Logger</title>
    <style>
        body { font-family: Arial, sans-serif; background: #0d1117; color: white; padding: 20px; }
        h1 { color: #25d366; }
        .error-box { background: #1e1f2e; padding: 20px; border-radius: 10px; margin-top: 20px; }
    </style>
</head>
<body>
    <h1>Chat App Logger</h1>
    <div class="error-box">
        <h3>⚠️ Error: HTML file not found</h3>
        <p>The web interface file <code>web/chat_app_logger.html</code> could not be loaded.</p>
        <p>Please make sure the file exists in the correct location.</p>
    </div>
</body>
</html>)";
}

/**
 * Extracts a field value from a JSON string.
 * 
 * @param body The JSON string to parse
 * @param field The field name to extract
 * @return The extracted value or empty string if not found
 */
string parseJson(const string& body, const string& field) {
    string searchFor = "\"" + field + "\":\"";
    size_t pos = body.find(searchFor);
    if (pos == string::npos) return "";
    
    pos += searchFor.length();
    size_t end = body.find("\"", pos);
    if (end == string::npos) end = body.length();
    
    return body.substr(pos, end - pos);
}

int main() {
    signal(SIGINT, signalHandler);
    signal(SIGTERM, signalHandler);
    
    ChatLogger logger(10); // Max 10/2 messages per user queue
    HttpServer server(8080);
    
    g_logger = &logger;
    g_server = &server;
    
    cout << "\n🚀 Starting Chat App Logger..." << endl;
    cout << "🔧 Features:" << endl;
    cout << "   • Queue-based message tracking (FIFO)" << endl;
    cout << "   • JSON data storage and export" << endl;
    cout << "   • Modern chat interface" << endl;
    cout << "   • Real-time message updates" << endl;
    cout << "   • Multi-user support with dropdown" << endl;
    cout << "   • Clear all data functionality" << endl;
    
    server.addRoute("/", [](const string& body) {
        return loadChatAppLoggerUI();
    });
    
    server.addRoute("/api/messages", [&logger](const string& body) {
        return logger.getAllMessagesJson();
    });
    
    // API endpoint to send a message
    server.addRoute("/api/send", [&logger](const string& body) {
        string username = parseJson(body, "username");
        string message = parseJson(body, "message");
        
        if (!username.empty() && !message.empty()) {
            logger.logMessage(username, message);
            return string("{\"success\":true,\"message\":\"Message sent successfully\"}");
        }
        
        return string("{\"success\":false,\"error\":\"Missing username or message\"}");
    });
    

    server.addRoute("/api/clear", [&logger](const string& body) {
        logger.clearAllData();
        return string("{\"success\":true,\"message\":\"All data cleared successfully\"}");
    });
    
    // Start server
    server.start();
    
    cout << "\n🌐 Server started successfully!" << endl;
    cout << "📱 Open your browser to: http://localhost:8080" << endl;
    cout << "📂 JSON data saved to: logs/chat_data.json" << endl;
    cout << "\n⚠️  Press Ctrl+C to shutdown gracefully..." << endl;
    
    // Keep the main thread alive
    while (true) {
        this_thread::sleep_for(chrono::seconds(1));
    }
    
    return 0;
}
